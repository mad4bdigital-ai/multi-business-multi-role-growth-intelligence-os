#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TOOL_VERSION="1.0.0"
POLICY_VERSION="hostinger-storage-cleanup-v1"
DEFAULT_MAX_FILES=5000
DEFAULT_MAX_DELETE_BYTES=$((5 * 1024 * 1024 * 1024))
DEFAULT_PLAN_TTL_SECONDS=3600
DEFAULT_SCAN_LARGE_FILE_BYTES=$((100 * 1024 * 1024))

ACTION="scan"
ROOT_INPUT="${HOME:-}"
PLAN_ID=""
CONFIRMATION=""
MAX_FILES="$DEFAULT_MAX_FILES"
MAX_DELETE_BYTES="$DEFAULT_MAX_DELETE_BYTES"
PLAN_TTL_SECONDS="$DEFAULT_PLAN_TTL_SECONDS"
OUTPUT_FORMAT="json"

usage() {
  cat <<'USAGE'
Usage:
  hostinger-storage-cleanup.sh scan [--root PATH] [--output json|text]
  hostinger-storage-cleanup.sh plan [--root PATH] [--max-files N] [--max-delete-bytes N]
  hostinger-storage-cleanup.sh apply --plan-id ID --confirm TOKEN [--root PATH]

Safety model:
  - scan and plan are read-only
  - apply only deletes files recorded in an unexpired plan
  - every candidate is revalidated by path, type, size, and mtime
  - symlinks, public_html, secrets, databases, mail, and backups are protected
USAGE
}

fail() {
  local code="$1"; shift
  printf 'ERROR[%s] %s\n' "$code" "$*" >&2
  exit 2
}

is_uint() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

json_escape() {
  local value="${1-}"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

base64_encode() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

base64_decode() {
  printf '%s' "$1" | base64 --decode
}

canonical_existing_dir() {
  local input="$1"
  [[ -n "$input" ]] || fail root_required "HOME/root is required"
  [[ -d "$input" ]] || fail root_not_directory "root is not a directory: $input"
  realpath -e -- "$input"
}

while (($#)); do
  case "$1" in
    scan|plan|apply) ACTION="$1"; shift ;;
    --root) ROOT_INPUT="${2-}"; shift 2 ;;
    --plan-id) PLAN_ID="${2-}"; shift 2 ;;
    --confirm) CONFIRMATION="${2-}"; shift 2 ;;
    --max-files) MAX_FILES="${2-}"; shift 2 ;;
    --max-delete-bytes) MAX_DELETE_BYTES="${2-}"; shift 2 ;;
    --plan-ttl-seconds) PLAN_TTL_SECONDS="${2-}"; shift 2 ;;
    --output) OUTPUT_FORMAT="${2-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail unsupported_argument "unsupported argument: $1" ;;
  esac
done

is_uint "$MAX_FILES" || fail invalid_max_files "max-files must be an unsigned integer"
is_uint "$MAX_DELETE_BYTES" || fail invalid_max_delete_bytes "max-delete-bytes must be an unsigned integer"
is_uint "$PLAN_TTL_SECONDS" || fail invalid_plan_ttl "plan-ttl-seconds must be an unsigned integer"
(( MAX_FILES >= 1 && MAX_FILES <= 10000 )) || fail invalid_max_files "max-files must be between 1 and 10000"
(( MAX_DELETE_BYTES >= 1 && MAX_DELETE_BYTES <= 10737418240 )) || fail invalid_max_delete_bytes "max-delete-bytes must be between 1 byte and 10 GiB"
(( PLAN_TTL_SECONDS >= 300 && PLAN_TTL_SECONDS <= 86400 )) || fail invalid_plan_ttl "plan TTL must be between 300 and 86400 seconds"
[[ "$OUTPUT_FORMAT" == "json" || "$OUTPUT_FORMAT" == "text" ]] || fail invalid_output "output must be json or text"

ROOT_CANON="$(canonical_existing_dir "$ROOT_INPUT")"
HOME_CANON="$(canonical_existing_dir "${HOME:-$ROOT_CANON}")"
case "$ROOT_CANON/" in
  "$HOME_CANON/"|"$HOME_CANON/"*) ;;
  *) fail root_outside_home "root must be the SSH account home or a descendant" ;;
esac
[[ "$ROOT_CANON" != "/" ]] || fail unsafe_root "root filesystem is never allowed"

STATE_DIR="$HOME_CANON/.mad4b-storage-cleanup"
PLAN_DIR="$STATE_DIR/plans"
AUDIT_LOG="$STATE_DIR/audit.jsonl"
umask 077
mkdir -p -- "$PLAN_DIR"
chmod 700 -- "$STATE_DIR" "$PLAN_DIR" 2>/dev/null || true

LOCK_DIR="$STATE_DIR/lock"
acquire_lock() {
  if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
    fail cleanup_locked "another storage cleanup process is active"
  fi
  trap 'rmdir -- "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
}

path_is_under() {
  local path="$1" root="$2"
  [[ "$path" == "$root" || "$path" == "$root/"* ]]
}

is_protected_path() {
  local path="$1" base
  base="$(basename -- "$path")"

  path_is_under "$path" "$STATE_DIR" && return 0
  [[ "$path" == *"/public_html/"* || "$path" == */public_html ]] && return 0
  [[ "$path" == *"/.ssh/"* || "$path" == */.ssh ]] && return 0
  [[ "$path" == *"/secrets/"* || "$path" == */secrets ]] && return 0
  [[ "$path" == *"/.config/"* || "$path" == */.config ]] && return 0
  [[ "$path" == *"/mail/"* || "$path" == */mail ]] && return 0
  [[ "$path" == *"/backups/"* || "$path" == */backups ]] && return 0
  [[ "$path" == *"/databases/"* || "$path" == */databases ]] && return 0

  case "$base" in
    .env|.env.*|.htaccess|authorized_keys|id_*|package.json|package-lock.json|server.js|*.pem|*.key|*.p12|*.pfx|*.sql|*.sqlite|*.sqlite3|*.db|*.bak|*.zip|*.tar|*.tgz|*.tar.gz)
      return 0 ;;
  esac
  return 1
}

validate_candidate_path() {
  local path="$1" canonical
  [[ -f "$path" && ! -L "$path" ]] || return 1
  canonical="$(realpath -e -- "$path" 2>/dev/null || true)"
  [[ -n "$canonical" ]] || return 1
  path_is_under "$canonical" "$ROOT_CANON" || return 1
  is_protected_path "$canonical" && return 1
  printf '%s' "$canonical"
}

filesystem_snapshot_json() {
  local df_line total used available percent mount
  df_line="$(df -Pk -- "$ROOT_CANON" | awk 'NR==2 {printf "%s\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5, $6}')"
  IFS=$'\t' read -r total used available percent mount <<<"$df_line"
  printf '{"total_kb":%s,"used_kb":%s,"available_kb":%s,"used_percent":"%s","mount":"%s"}' \
    "${total:-0}" "${used:-0}" "${available:-0}" "$(json_escape "${percent:-unknown}")" "$(json_escape "${mount:-unknown}")"
}

scan_action() {
  local snapshot top_file large_file
  snapshot="$(filesystem_snapshot_json)"
  top_file="$(mktemp "$STATE_DIR/scan-top.XXXXXX")"
  large_file="$(mktemp "$STATE_DIR/scan-large.XXXXXX")"

  du -x -k --max-depth=2 -- "$ROOT_CANON" 2>/dev/null | sort -nr | head -50 >"$top_file" || true
  find -P "$ROOT_CANON" -xdev -type f -size +"${DEFAULT_SCAN_LARGE_FILE_BYTES}"c -printf '%s\t%T@\t%p\n' 2>/dev/null \
    | sort -nr | head -100 >"$large_file" || true

  if [[ "$OUTPUT_FORMAT" == "text" ]]; then
    printf 'tool_version=%s\npolicy_version=%s\nroot=%s\nfilesystem=%s\n' "$TOOL_VERSION" "$POLICY_VERSION" "$ROOT_CANON" "$snapshot"
    printf '\nTop directories (KiB):\n'; cat -- "$top_file"
    printf '\nLarge files (>100 MiB):\n'; cat -- "$large_file"
    rm -f -- "$top_file" "$large_file"
    return 0
  fi

  printf '{"ok":true,"action":"scan","tool_version":"%s","policy_version":"%s","root":"%s","filesystem":%s,' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$(json_escape "$ROOT_CANON")" "$snapshot"
  printf '"top_directories":['
  local first=1 size path
  while IFS=$'\t ' read -r size path; do
    [[ -n "${size:-}" && -n "${path:-}" ]] || continue
    (( first )) || printf ','; first=0
    printf '{"size_kb":%s,"path":"%s"}' "$size" "$(json_escape "$path")"
  done <"$top_file"
  printf '],"large_files":['
  first=1
  local bytes mtime
  while IFS=$'\t' read -r bytes mtime path; do
    [[ -n "${bytes:-}" && -n "${path:-}" ]] || continue
    (( first )) || printf ','; first=0
    printf '{"size_bytes":%s,"mtime_epoch":%s,"path":"%s"}' "$bytes" "${mtime%%.*}" "$(json_escape "$path")"
  done <"$large_file"
  printf '],"deletion_executed":false,"secrets_included":false}\n'
  rm -f -- "$top_file" "$large_file"
}

PLAN_TMP=""
PLAN_COUNT=0
PLAN_BYTES=0

add_candidate() {
  local raw_path="$1" category="$2" canonical size mtime encoded
  (( PLAN_COUNT < MAX_FILES )) || return 0
  canonical="$(validate_candidate_path "$raw_path" || true)"
  [[ -n "$canonical" ]] || return 0
  size="$(stat -c '%s' -- "$canonical" 2>/dev/null || true)"
  mtime="$(stat -c '%Y' -- "$canonical" 2>/dev/null || true)"
  is_uint "$size" || return 0
  is_uint "$mtime" || return 0
  (( PLAN_BYTES + size <= MAX_DELETE_BYTES )) || return 0
  encoded="$(base64_encode "$canonical")"
  printf '%s\t%s\t%s\t%s\n' "$size" "$mtime" "$category" "$encoded" >>"$PLAN_TMP"
  PLAN_COUNT=$((PLAN_COUNT + 1))
  PLAN_BYTES=$((PLAN_BYTES + size))
}

collect_find_candidates() {
  local root="$1" category="$2" age_days="$3" mode="$4"
  [[ -d "$root" ]] || return 0
  local path
  if [[ "$mode" == "all" ]]; then
    while IFS= read -r -d '' path; do add_candidate "$path" "$category"; done \
      < <(find -P "$root" -xdev -type f -mtime "+$age_days" -print0 2>/dev/null)
  else
    while IFS= read -r -d '' path; do add_candidate "$path" "$category"; done \
      < <(find -P "$root" -xdev -type f -mtime "+$age_days" \
        \( -name '*.gz' -o -name '*.old' -o -name '*.log.[0-9]*' -o -name '*.log-*' -o -name '*.log.*.gz' \) -print0 2>/dev/null)
  fi
}

plan_action() {
  acquire_lock
  PLAN_TMP="$(mktemp "$STATE_DIR/plan-candidates.XXXXXX")"
  trap 'rm -f -- "$PLAN_TMP"; rmdir -- "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

  collect_find_candidates "$HOME_CANON/.npm/_cacache" "npm_cache" 14 all
  collect_find_candidates "$HOME_CANON/.npm/_logs" "npm_logs" 14 all
  collect_find_candidates "$HOME_CANON/tmp" "account_tmp" 7 all
  collect_find_candidates "$HOME_CANON/logs" "account_rotated_logs" 14 rotated_logs

  local domain_logs
  while IFS= read -r -d '' domain_logs; do
    collect_find_candidates "$domain_logs" "domain_rotated_logs" 14 rotated_logs
  done < <(find -P "$HOME_CANON/domains" -mindepth 2 -maxdepth 2 -type d -name logs -print0 2>/dev/null || true)

  sort -nr -k1,1 -o "$PLAN_TMP" -- "$PLAN_TMP"
  local created_epoch expires_epoch plan_hash plan_nonce plan_id plan_file meta_file token confirmation snapshot
  created_epoch="$(date +%s)"
  expires_epoch=$((created_epoch + PLAN_TTL_SECONDS))
  plan_hash="$(sha256sum "$PLAN_TMP" | awk '{print $1}')"
  plan_nonce="$(sha256_text "$$:$RANDOM:$created_epoch:$plan_hash" | cut -c1-6)"
  plan_id="$(date -u +%Y%m%dT%H%M%SZ)-${plan_hash:0:12}-${plan_nonce}"
  plan_file="$PLAN_DIR/$plan_id.tsv"
  meta_file="$PLAN_DIR/$plan_id.meta"
  mv -- "$PLAN_TMP" "$plan_file"
  PLAN_TMP=""
  printf 'policy_version=%s\ncreated_epoch=%s\nexpires_epoch=%s\nroot_b64=%s\ncount=%s\ntotal_bytes=%s\nplan_hash=%s\n' \
    "$POLICY_VERSION" "$created_epoch" "$expires_epoch" "$(base64_encode "$ROOT_CANON")" "$PLAN_COUNT" "$PLAN_BYTES" "$plan_hash" >"$meta_file"
  chmod 600 -- "$plan_file" "$meta_file"
  token="$(sha256_text "$plan_id:$PLAN_BYTES:$PLAN_COUNT:$expires_epoch:$POLICY_VERSION:$plan_hash")"
  confirmation="APPLY_HOSTINGER_STORAGE_CLEANUP:$plan_id:$token"
  snapshot="$(filesystem_snapshot_json)"

  printf '{"ok":true,"action":"plan","tool_version":"%s","policy_version":"%s","root":"%s","plan_id":"%s","candidate_count":%s,"candidate_bytes":%s,"expires_epoch":%s,"confirmation":"%s","filesystem":%s,"deletion_executed":false,"secrets_included":false}\n' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$(json_escape "$ROOT_CANON")" "$plan_id" "$PLAN_COUNT" "$PLAN_BYTES" "$expires_epoch" "$confirmation" "$snapshot"
}

read_meta_value() {
  local file="$1" key="$2"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

apply_action() {
  acquire_lock
  [[ "$PLAN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}-[a-f0-9]{6}$ ]] || fail invalid_plan_id "invalid plan id"
  local plan_file="$PLAN_DIR/$PLAN_ID.tsv" meta_file="$PLAN_DIR/$PLAN_ID.meta"
  [[ -f "$plan_file" && -f "$meta_file" ]] || fail plan_not_found "plan not found"

  local policy created expires root_b64 count total_bytes plan_hash current_hash expected_token expected_confirmation now
  policy="$(read_meta_value "$meta_file" policy_version)"
  created="$(read_meta_value "$meta_file" created_epoch)"
  expires="$(read_meta_value "$meta_file" expires_epoch)"
  root_b64="$(read_meta_value "$meta_file" root_b64)"
  count="$(read_meta_value "$meta_file" count)"
  total_bytes="$(read_meta_value "$meta_file" total_bytes)"
  plan_hash="$(read_meta_value "$meta_file" plan_hash)"
  [[ "$policy" == "$POLICY_VERSION" ]] || fail policy_mismatch "plan policy does not match current policy"
  [[ "$(base64_decode "$root_b64")" == "$ROOT_CANON" ]] || fail root_mismatch "plan root does not match requested root"
  current_hash="$(sha256sum "$plan_file" | awk '{print $1}')"
  [[ "$current_hash" == "$plan_hash" ]] || fail plan_tampered "plan content hash mismatch"
  now="$(date +%s)"
  (( now <= expires )) || fail plan_expired "plan has expired"
  expected_token="$(sha256_text "$PLAN_ID:$total_bytes:$count:$expires:$POLICY_VERSION:$plan_hash")"
  expected_confirmation="APPLY_HOSTINGER_STORAGE_CLEANUP:$PLAN_ID:$expected_token"
  [[ "$CONFIRMATION" == "$expected_confirmation" ]] || fail confirmation_mismatch "typed confirmation does not match the plan"

  local deleted_count=0 deleted_bytes=0 skipped_count=0 size mtime category encoded path canonical current_size current_mtime
  while IFS=$'\t' read -r size mtime category encoded; do
    [[ -n "${encoded:-}" ]] || continue
    path="$(base64_decode "$encoded" 2>/dev/null || true)"
    canonical="$(validate_candidate_path "$path" || true)"
    if [[ -z "$canonical" ]]; then skipped_count=$((skipped_count + 1)); continue; fi
    current_size="$(stat -c '%s' -- "$canonical" 2>/dev/null || true)"
    current_mtime="$(stat -c '%Y' -- "$canonical" 2>/dev/null || true)"
    if [[ "$current_size" != "$size" || "$current_mtime" != "$mtime" ]]; then
      skipped_count=$((skipped_count + 1)); continue
    fi
    rm -- "$canonical"
    deleted_count=$((deleted_count + 1))
    deleted_bytes=$((deleted_bytes + size))
  done <"$plan_file"

  local finished_epoch snapshot
  finished_epoch="$(date +%s)"
  snapshot="$(filesystem_snapshot_json)"
  printf '{"timestamp_epoch":%s,"action":"apply","plan_id":"%s","deleted_count":%s,"deleted_bytes":%s,"skipped_count":%s,"policy_version":"%s","secrets_included":false}\n' \
    "$finished_epoch" "$PLAN_ID" "$deleted_count" "$deleted_bytes" "$skipped_count" "$POLICY_VERSION" >>"$AUDIT_LOG"
  chmod 600 -- "$AUDIT_LOG"
  printf '{"ok":true,"action":"apply","tool_version":"%s","policy_version":"%s","plan_id":"%s","deleted_count":%s,"deleted_bytes":%s,"skipped_count":%s,"filesystem":%s,"deletion_executed":true,"secrets_included":false}\n' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$PLAN_ID" "$deleted_count" "$deleted_bytes" "$skipped_count" "$snapshot"
}

case "$ACTION" in
  scan) acquire_lock; scan_action ;;
  plan) plan_action ;;
  apply) apply_action ;;
  *) fail unsupported_action "unsupported action: $ACTION" ;;
esac
