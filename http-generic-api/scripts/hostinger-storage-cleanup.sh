#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TOOL_VERSION="2.0.0"
POLICY_VERSION="hostinger-storage-cleanup-v2"
DEFAULT_MAX_FILES=5000
DEFAULT_MAX_DELETE_BYTES=$((5 * 1024 * 1024 * 1024))
DEFAULT_PLAN_TTL_SECONDS=3600
DEFAULT_SCAN_LARGE_FILE_BYTES=$((100 * 1024 * 1024))
DEFAULT_INSPECT_LIMIT=200
DEFAULT_RESERVE_BYTES=$((64 * 1024 * 1024))
MAX_RESERVE_BYTES=$((512 * 1024 * 1024))

ACTION="scan"
ROOT_INPUT="${HOME:-}"
PLAN_ID=""
CONFIRMATION=""
EXPECTED_PLAN_HASH=""
MAX_FILES="$DEFAULT_MAX_FILES"
MAX_DELETE_BYTES="$DEFAULT_MAX_DELETE_BYTES"
PLAN_TTL_SECONDS="$DEFAULT_PLAN_TTL_SECONDS"
OUTPUT_FORMAT="json"
INSPECT_LIMIT="$DEFAULT_INSPECT_LIMIT"
RESERVE_BYTES="$DEFAULT_RESERVE_BYTES"

usage() {
  cat <<'USAGE'
Usage:
  hostinger-storage-cleanup.sh scan [--root PATH] [--output json|text]
  hostinger-storage-cleanup.sh plan [--root PATH] [--max-files N] [--max-delete-bytes N]
  hostinger-storage-cleanup.sh inspect --plan-id ID [--root PATH] [--inspect-limit N]
  hostinger-storage-cleanup.sh apply --plan-id ID --expected-plan-hash HASH --confirm TOKEN [--root PATH]
  hostinger-storage-cleanup.sh reserve-status [--root PATH]
  hostinger-storage-cleanup.sh reserve-create --reserve-bytes N --confirm TOKEN [--root PATH]
  hostinger-storage-cleanup.sh reserve-release --confirm TOKEN [--root PATH]

Safety model:
  - scan is read-only and does not require state-directory writes
  - plan and inspect never delete application data
  - apply only deletes exact files recorded in an unexpired plan
  - apply revalidates path, file type, device, inode, size, ctime, and mtime
  - public_html, secrets, databases, mail, backups, archives, and active app files are protected
  - account tmp and deployment trees are report-only until a provider-specific policy proves them inactive
USAGE
}

fail() {
  local code="$1"; shift
  printf 'ERROR[%s] %s\n' "$code" "$*" >&2
  exit 2
}

is_uint() {
  [[ "${1-}" =~ ^[0-9]+$ ]]
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
    scan|plan|inspect|apply|reserve-status|reserve-create|reserve-release) ACTION="$1"; shift ;;
    --root) ROOT_INPUT="${2-}"; shift 2 ;;
    --plan-id) PLAN_ID="${2-}"; shift 2 ;;
    --confirm) CONFIRMATION="${2-}"; shift 2 ;;
    --expected-plan-hash) EXPECTED_PLAN_HASH="${2-}"; shift 2 ;;
    --max-files) MAX_FILES="${2-}"; shift 2 ;;
    --max-delete-bytes) MAX_DELETE_BYTES="${2-}"; shift 2 ;;
    --plan-ttl-seconds) PLAN_TTL_SECONDS="${2-}"; shift 2 ;;
    --inspect-limit) INSPECT_LIMIT="${2-}"; shift 2 ;;
    --reserve-bytes) RESERVE_BYTES="${2-}"; shift 2 ;;
    --output) OUTPUT_FORMAT="${2-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail unsupported_argument "unsupported argument: $1" ;;
  esac
done

is_uint "$MAX_FILES" || fail invalid_max_files "max-files must be an unsigned integer"
is_uint "$MAX_DELETE_BYTES" || fail invalid_max_delete_bytes "max-delete-bytes must be an unsigned integer"
is_uint "$PLAN_TTL_SECONDS" || fail invalid_plan_ttl "plan-ttl-seconds must be an unsigned integer"
is_uint "$INSPECT_LIMIT" || fail invalid_inspect_limit "inspect-limit must be an unsigned integer"
is_uint "$RESERVE_BYTES" || fail invalid_reserve_bytes "reserve-bytes must be an unsigned integer"
(( MAX_FILES >= 1 && MAX_FILES <= 10000 )) || fail invalid_max_files "max-files must be between 1 and 10000"
(( MAX_DELETE_BYTES >= 1 && MAX_DELETE_BYTES <= 10737418240 )) || fail invalid_max_delete_bytes "max-delete-bytes must be between 1 byte and 10 GiB"
(( PLAN_TTL_SECONDS >= 300 && PLAN_TTL_SECONDS <= 86400 )) || fail invalid_plan_ttl "plan TTL must be between 300 and 86400 seconds"
(( INSPECT_LIMIT >= 1 && INSPECT_LIMIT <= 1000 )) || fail invalid_inspect_limit "inspect-limit must be between 1 and 1000"
(( RESERVE_BYTES >= 1048576 && RESERVE_BYTES <= MAX_RESERVE_BYTES )) || fail invalid_reserve_bytes "reserve-bytes must be between 1 MiB and 512 MiB"
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
RESERVE_FILE="$STATE_DIR/emergency.reserve"
LOCK_DIR="$STATE_DIR/lock"
umask 077

ensure_state_dir() {
  mkdir -p -- "$PLAN_DIR" || fail state_directory_unavailable "unable to create cleanup state directory; release emergency reserve or request temporary storage boost"
  chmod 700 -- "$STATE_DIR" "$PLAN_DIR" 2>/dev/null || true
}

acquire_lock() {
  ensure_state_dir
  if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
    fail cleanup_locked "another storage cleanup process is active"
  fi
  trap 'rmdir -- "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
}

path_is_under() {
  local path="$1" root="$2"
  [[ "$path" == "$root" || "$path" == "$root/"* ]]
}

relative_path() {
  realpath --relative-to="$ROOT_CANON" -- "$1" 2>/dev/null || printf '%s' "$1"
}

is_protected_path() {
  local path="$1" base lower
  base="$(basename -- "$path")"
  lower="${path,,}"

  path_is_under "$path" "$STATE_DIR" && return 0
  [[ "$lower" == *"/public_html/"* || "$lower" == */public_html ]] && return 0
  [[ "$lower" == *"/.ssh/"* || "$lower" == */.ssh ]] && return 0
  [[ "$lower" == *"/secrets/"* || "$lower" == */secrets ]] && return 0
  [[ "$lower" == *"/.config/"* || "$lower" == */.config ]] && return 0
  [[ "$lower" == *"/mail/"* || "$lower" == */mail ]] && return 0
  [[ "$lower" == *"/backups/"* || "$lower" == */backups ]] && return 0
  [[ "$lower" == *"/databases/"* || "$lower" == */databases ]] && return 0
  [[ "$lower" == *"/ssl/"* || "$lower" == */ssl ]] && return 0

  case "$base" in
    .env|.env.*|.htaccess|authorized_keys|id_*|package.json|package-lock.json|npm-shrinkwrap.json|server.js|*.pem|*.key|*.p12|*.pfx|*.crt|*.cer|*.sql|*.sqlite|*.sqlite3|*.db|*.bak|*.zip|*.tar|*.tgz|*.tar.gz|*.7z)
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

filesystem_bytes_json() {
  local line total used available percent mount
  line="$(df -Pk -- "$ROOT_CANON" | awk 'NR==2 {printf "%s\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5, $6}')"
  IFS=$'\t' read -r total used available percent mount <<<"$line"
  printf '{"source":"filesystem_not_hosting_plan_quota","total_kb":%s,"used_kb":%s,"available_kb":%s,"used_percent":"%s","mount":"%s"}' \
    "${total:-0}" "${used:-0}" "${available:-0}" "$(json_escape "${percent:-unknown}")" "$(json_escape "${mount:-unknown}")"
}

filesystem_inodes_json() {
  local line total used available percent mount
  line="$(df -Pi -- "$ROOT_CANON" | awk 'NR==2 {printf "%s\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5, $6}')"
  IFS=$'\t' read -r total used available percent mount <<<"$line"
  printf '{"source":"filesystem_not_hosting_plan_quota","total":%s,"used":%s,"available":%s,"used_percent":"%s","mount":"%s"}' \
    "${total:-0}" "${used:-0}" "${available:-0}" "$(json_escape "${percent:-unknown}")" "$(json_escape "${mount:-unknown}")"
}

account_usage_kb() {
  du -skx -- "$ROOT_CANON" 2>/dev/null | awk 'NR==1 {print $1+0}'
}

account_inode_count() {
  find -P "$ROOT_CANON" -xdev -printf '.' 2>/dev/null | wc -c | tr -d ' '
}

print_top_directories_json() {
  local first=1 size path rel
  while IFS=$'\t ' read -r size path; do
    [[ -n "${size:-}" && -n "${path:-}" ]] || continue
    rel="$(relative_path "$path")"
    (( first )) || printf ','; first=0
    printf '{"size_kb":%s,"relative_path":"%s"}' "$size" "$(json_escape "$rel")"
  done < <(du -x -k --max-depth=2 -- "$ROOT_CANON" 2>/dev/null | sort -nr | head -50 || true)
}

print_inode_hotspots_json() {
  local first=1 count bucket
  while IFS=$'\t ' read -r count bucket; do
    [[ -n "${count:-}" && -n "${bucket:-}" ]] || continue
    (( first )) || printf ','; first=0
    printf '{"inode_count":%s,"relative_path":"%s"}' "$count" "$(json_escape "$bucket")"
  done < <(
    cd "$ROOT_CANON" &&
    find -P . -xdev -mindepth 1 -printf '%h\n' 2>/dev/null \
      | awk -F/ '{ if (NF >= 3) print "./"$2"/"$3; else if (NF >= 2) print "./"$2; else print "." }' \
      | sort | uniq -c | sort -nr | head -50 \
      | awk '{count=$1; $1=""; sub(/^ /,""); printf "%s\t%s\n", count, $0}' || true
  )
}

print_large_files_json() {
  local first=1 bytes mtime path rel protected
  while IFS=$'\t' read -r bytes mtime path; do
    [[ -n "${bytes:-}" && -n "${path:-}" ]] || continue
    rel="$(relative_path "$path")"
    protected=false
    is_protected_path "$path" && protected=true
    (( first )) || printf ','; first=0
    printf '{"size_bytes":%s,"mtime_epoch":%s,"relative_path":"%s","protected":%s}' \
      "$bytes" "${mtime%%.*}" "$(json_escape "$rel")" "$protected"
  done < <(find -P "$ROOT_CANON" -xdev -type f -size +"${DEFAULT_SCAN_LARGE_FILE_BYTES}"c -printf '%s\t%T@\t%p\n' 2>/dev/null | sort -nr | head -100 || true)
}

scan_action() {
  local bytes_snapshot inode_snapshot usage_kb inode_count
  bytes_snapshot="$(filesystem_bytes_json)"
  inode_snapshot="$(filesystem_inodes_json)"
  usage_kb="$(account_usage_kb)"
  inode_count="$(account_inode_count)"

  if [[ "$OUTPUT_FORMAT" == "text" ]]; then
    printf 'tool_version=%s\npolicy_version=%s\nroot=%s\nfilesystem_bytes=%s\nfilesystem_inodes=%s\naccount_usage_kb=%s\naccount_inode_count=%s\n' \
      "$TOOL_VERSION" "$POLICY_VERSION" "$ROOT_CANON" "$bytes_snapshot" "$inode_snapshot" "$usage_kb" "$inode_count"
    printf '\nTop directories (KiB):\n'
    du -x -k --max-depth=2 -- "$ROOT_CANON" 2>/dev/null | sort -nr | head -50 || true
    printf '\nInode hotspots:\n'
    (cd "$ROOT_CANON" && find -P . -xdev -mindepth 1 -printf '%h\n' 2>/dev/null | awk -F/ '{ if (NF >= 3) print "./"$2"/"$3; else if (NF >= 2) print "./"$2; else print "." }' | sort | uniq -c | sort -nr | head -50) || true
    printf '\nLarge files (>100 MiB):\n'
    find -P "$ROOT_CANON" -xdev -type f -size +"${DEFAULT_SCAN_LARGE_FILE_BYTES}"c -printf '%s\t%T@\t%p\n' 2>/dev/null | sort -nr | head -100 || true
    return 0
  fi

  printf '{"ok":true,"action":"scan","tool_version":"%s","policy_version":"%s","root_scope":"ssh_account_or_descendant","filesystem_bytes":%s,"filesystem_inodes":%s,"account_usage_kb":%s,"account_inode_count":%s,' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$bytes_snapshot" "$inode_snapshot" "$usage_kb" "$inode_count"
  printf '"top_directories":['; print_top_directories_json; printf '],'
  printf '"inode_hotspots":['; print_inode_hotspots_json; printf '],'
  printf '"large_files":['; print_large_files_json; printf '],'
  printf '"hosting_plan_limits_source":"hpanel_resources_usage_required","state_directory_write_required":false,"deletion_executed":false,"secrets_included":false}\n'
}

PLAN_TMP=""
PLAN_COUNT=0
PLAN_BYTES=0
declare -A PLAN_SEEN=()

add_candidate() {
  local raw_path="$1" category="$2" canonical size mtime ctime dev inode encoded
  (( PLAN_COUNT < MAX_FILES )) || return 0
  canonical="$(validate_candidate_path "$raw_path" || true)"
  [[ -n "$canonical" ]] || return 0
  [[ -z "${PLAN_SEEN[$canonical]+x}" ]] || return 0
  size="$(stat -c '%s' -- "$canonical" 2>/dev/null || true)"
  mtime="$(stat -c '%Y' -- "$canonical" 2>/dev/null || true)"
  ctime="$(stat -c '%Z' -- "$canonical" 2>/dev/null || true)"
  dev="$(stat -c '%d' -- "$canonical" 2>/dev/null || true)"
  inode="$(stat -c '%i' -- "$canonical" 2>/dev/null || true)"
  is_uint "$size" || return 0
  is_uint "$mtime" || return 0
  is_uint "$ctime" || return 0
  is_uint "$dev" || return 0
  is_uint "$inode" || return 0
  (( PLAN_BYTES + size <= MAX_DELETE_BYTES )) || return 0
  encoded="$(base64_encode "$canonical")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$size" "$mtime" "$ctime" "$dev" "$inode" "$category" "$encoded" >>"$PLAN_TMP"
  PLAN_SEEN[$canonical]=1
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

print_category_summary_json() {
  local plan_file="$1" first=1 category count bytes
  while IFS=$'\t' read -r category count bytes; do
    [[ -n "${category:-}" ]] || continue
    (( first )) || printf ','; first=0
    printf '{"category":"%s","count":%s,"bytes":%s}' "$(json_escape "$category")" "$count" "$bytes"
  done < <(awk -F'\t' '{count[$6]++; bytes[$6]+=$1} END {for (c in count) printf "%s\t%d\t%.0f\n", c, count[c], bytes[c]}' "$plan_file" | sort)
}

plan_action() {
  acquire_lock
  PLAN_TMP="$(mktemp "$STATE_DIR/plan-candidates.XXXXXX")"
  trap 'rm -f -- "$PLAN_TMP"; rmdir -- "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

  collect_find_candidates "$ROOT_CANON/.npm/_cacache" "npm_cache" 14 all
  collect_find_candidates "$ROOT_CANON/.npm/_logs" "npm_logs" 14 all
  collect_find_candidates "$ROOT_CANON/logs" "account_rotated_logs" 14 rotated_logs

  local domain_logs
  while IFS= read -r -d '' domain_logs; do
    collect_find_candidates "$domain_logs" "domain_rotated_logs" 14 rotated_logs
  done < <(find -P "$ROOT_CANON/domains" -mindepth 2 -maxdepth 2 -type d -name logs -print0 2>/dev/null || true)

  sort -nr -k1,1 -o "$PLAN_TMP" -- "$PLAN_TMP"
  local created_epoch expires_epoch plan_hash plan_nonce plan_id plan_file meta_file token confirmation bytes_snapshot inode_snapshot
  created_epoch="$(date +%s)"
  expires_epoch=$((created_epoch + PLAN_TTL_SECONDS))
  plan_hash="$(sha256sum "$PLAN_TMP" | awk '{print $1}')"
  plan_nonce="$(sha256_text "$$:$RANDOM:$created_epoch:$plan_hash" | cut -c1-6)"
  plan_id="$(date -u +%Y%m%dT%H%M%SZ)-${plan_hash:0:12}-${plan_nonce}"
  plan_file="$PLAN_DIR/$plan_id.tsv"
  meta_file="$PLAN_DIR/$plan_id.meta"
  mv -- "$PLAN_TMP" "$plan_file"
  PLAN_TMP=""
  printf 'policy_version=%s\ncreated_epoch=%s\nexpires_epoch=%s\nroot_b64=%s\ncount=%s\ntotal_bytes=%s\nplan_hash=%s\nstatus=planned\n' \
    "$POLICY_VERSION" "$created_epoch" "$expires_epoch" "$(base64_encode "$ROOT_CANON")" "$PLAN_COUNT" "$PLAN_BYTES" "$plan_hash" >"$meta_file"
  chmod 600 -- "$plan_file" "$meta_file"
  token="$(sha256_text "$plan_id:$PLAN_BYTES:$PLAN_COUNT:$expires_epoch:$POLICY_VERSION:$plan_hash")"
  confirmation="APPLY_HOSTINGER_STORAGE_CLEANUP:$plan_id:$token"
  bytes_snapshot="$(filesystem_bytes_json)"
  inode_snapshot="$(filesystem_inodes_json)"

  printf '{"ok":true,"action":"plan","tool_version":"%s","policy_version":"%s","plan_id":"%s","plan_hash":"%s","candidate_count":%s,"candidate_bytes":%s,"expires_epoch":%s,"confirmation":"%s","categories":[' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$plan_id" "$plan_hash" "$PLAN_COUNT" "$PLAN_BYTES" "$expires_epoch" "$confirmation"
  print_category_summary_json "$plan_file"
  printf '],"filesystem_bytes":%s,"filesystem_inodes":%s,"review_required_categories":["account_tmp","deployment_history","node_modules","build_artifacts","manual_backups"],"next_action":"inspect","deletion_executed":false,"secrets_included":false}\n' \
    "$bytes_snapshot" "$inode_snapshot"
}

read_meta_value() {
  local file="$1" key="$2"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

load_plan_paths() {
  [[ "$PLAN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}-[a-f0-9]{6}$ ]] || fail invalid_plan_id "invalid plan id"
  PLAN_FILE="$PLAN_DIR/$PLAN_ID.tsv"
  META_FILE="$PLAN_DIR/$PLAN_ID.meta"
  APPLIED_FILE="$PLAN_DIR/$PLAN_ID.applied"
  JOURNAL_FILE="$PLAN_DIR/$PLAN_ID.journal"
  [[ -f "$PLAN_FILE" && -f "$META_FILE" ]] || fail plan_not_found "plan not found"
}

validate_plan_integrity() {
  local root_b64 current_hash
  PLAN_POLICY="$(read_meta_value "$META_FILE" policy_version)"
  PLAN_CREATED="$(read_meta_value "$META_FILE" created_epoch)"
  PLAN_EXPIRES="$(read_meta_value "$META_FILE" expires_epoch)"
  root_b64="$(read_meta_value "$META_FILE" root_b64)"
  PLAN_COUNT_META="$(read_meta_value "$META_FILE" count)"
  PLAN_BYTES_META="$(read_meta_value "$META_FILE" total_bytes)"
  PLAN_HASH_META="$(read_meta_value "$META_FILE" plan_hash)"
  [[ "$PLAN_POLICY" == "$POLICY_VERSION" ]] || fail policy_mismatch "plan policy does not match current policy"
  [[ "$(base64_decode "$root_b64")" == "$ROOT_CANON" ]] || fail root_mismatch "plan root does not match requested root"
  current_hash="$(sha256sum "$PLAN_FILE" | awk '{print $1}')"
  [[ "$current_hash" == "$PLAN_HASH_META" ]] || fail plan_tampered "plan content hash mismatch"
}

inspect_action() {
  ensure_state_dir
  load_plan_paths
  validate_plan_integrity
  local now expired=false first=1 shown=0 size mtime ctime dev inode category encoded path canonical rel
  now="$(date +%s)"
  (( now > PLAN_EXPIRES )) && expired=true
  printf '{"ok":true,"action":"inspect","tool_version":"%s","policy_version":"%s","plan_id":"%s","plan_hash":"%s","candidate_count":%s,"candidate_bytes":%s,"expires_epoch":%s,"expired":%s,"already_applied":%s,"candidates":[' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$PLAN_ID" "$PLAN_HASH_META" "$PLAN_COUNT_META" "$PLAN_BYTES_META" "$PLAN_EXPIRES" "$expired" "$([[ -f "$APPLIED_FILE" ]] && echo true || echo false)"
  while IFS=$'\t' read -r size mtime ctime dev inode category encoded; do
    (( shown < INSPECT_LIMIT )) || break
    path="$(base64_decode "$encoded" 2>/dev/null || true)"
    canonical="$(validate_candidate_path "$path" || true)"
    rel="$(relative_path "${canonical:-$path}")"
    (( first )) || printf ','; first=0
    printf '{"relative_path":"%s","category":"%s","size_bytes":%s,"mtime_epoch":%s,"device":%s,"inode":%s,"still_valid":%s}' \
      "$(json_escape "$rel")" "$(json_escape "$category")" "$size" "$mtime" "$dev" "$inode" "$([[ -n "$canonical" ]] && echo true || echo false)"
    shown=$((shown + 1))
  done <"$PLAN_FILE"
  printf '],"shown_count":%s,"truncated":%s,"deletion_executed":false,"secrets_included":false}\n' \
    "$shown" "$([[ "$shown" -lt "$PLAN_COUNT_META" ]] && echo true || echo false)"
}

apply_action() {
  acquire_lock
  load_plan_paths
  validate_plan_integrity
  [[ ! -f "$APPLIED_FILE" ]] || fail plan_already_applied "plan has already been applied"
  [[ "$EXPECTED_PLAN_HASH" =~ ^[a-f0-9]{64}$ ]] || fail expected_plan_hash_required "expected-plan-hash must be a 64-character lowercase SHA-256"
  [[ "$EXPECTED_PLAN_HASH" == "$PLAN_HASH_META" ]] || fail expected_plan_hash_mismatch "expected plan hash does not match inspected plan"

  local now expected_token expected_confirmation
  now="$(date +%s)"
  (( now <= PLAN_EXPIRES )) || fail plan_expired "plan has expired"
  expected_token="$(sha256_text "$PLAN_ID:$PLAN_BYTES_META:$PLAN_COUNT_META:$PLAN_EXPIRES:$POLICY_VERSION:$PLAN_HASH_META")"
  expected_confirmation="APPLY_HOSTINGER_STORAGE_CLEANUP:$PLAN_ID:$expected_token"
  [[ "$CONFIRMATION" == "$expected_confirmation" ]] || fail confirmation_mismatch "typed confirmation does not match the plan"

  local deleted_count=0 deleted_bytes=0 skipped_count=0 size mtime ctime dev inode category encoded path canonical
  local current_size current_mtime current_ctime current_dev current_inode
  : >"$JOURNAL_FILE"
  chmod 600 -- "$JOURNAL_FILE"
  while IFS=$'\t' read -r size mtime ctime dev inode category encoded; do
    [[ -n "${encoded:-}" ]] || continue
    path="$(base64_decode "$encoded" 2>/dev/null || true)"
    canonical="$(validate_candidate_path "$path" || true)"
    if [[ -z "$canonical" ]]; then
      skipped_count=$((skipped_count + 1)); continue
    fi
    current_size="$(stat -c '%s' -- "$canonical" 2>/dev/null || true)"
    current_mtime="$(stat -c '%Y' -- "$canonical" 2>/dev/null || true)"
    current_ctime="$(stat -c '%Z' -- "$canonical" 2>/dev/null || true)"
    current_dev="$(stat -c '%d' -- "$canonical" 2>/dev/null || true)"
    current_inode="$(stat -c '%i' -- "$canonical" 2>/dev/null || true)"
    if [[ "$current_size" != "$size" || "$current_mtime" != "$mtime" || "$current_ctime" != "$ctime" || "$current_dev" != "$dev" || "$current_inode" != "$inode" ]]; then
      skipped_count=$((skipped_count + 1)); continue
    fi
    rm -- "$canonical"
    printf '%s\t%s\t%s\n' "$(date +%s)" "$size" "$encoded" >>"$JOURNAL_FILE"
    deleted_count=$((deleted_count + 1))
    deleted_bytes=$((deleted_bytes + size))
  done <"$PLAN_FILE"

  local finished_epoch bytes_snapshot inode_snapshot
  finished_epoch="$(date +%s)"
  printf 'plan_id=%s\nplan_hash=%s\napplied_epoch=%s\ndeleted_count=%s\ndeleted_bytes=%s\nskipped_count=%s\n' \
    "$PLAN_ID" "$PLAN_HASH_META" "$finished_epoch" "$deleted_count" "$deleted_bytes" "$skipped_count" >"$APPLIED_FILE"
  chmod 600 -- "$APPLIED_FILE"
  bytes_snapshot="$(filesystem_bytes_json)"
  inode_snapshot="$(filesystem_inodes_json)"
  printf '{"timestamp_epoch":%s,"action":"apply","plan_id":"%s","plan_hash":"%s","deleted_count":%s,"deleted_bytes":%s,"skipped_count":%s,"policy_version":"%s","secrets_included":false}\n' \
    "$finished_epoch" "$PLAN_ID" "$PLAN_HASH_META" "$deleted_count" "$deleted_bytes" "$skipped_count" "$POLICY_VERSION" >>"$AUDIT_LOG"
  chmod 600 -- "$AUDIT_LOG"
  printf '{"ok":true,"action":"apply","tool_version":"%s","policy_version":"%s","plan_id":"%s","plan_hash":"%s","deleted_count":%s,"deleted_bytes":%s,"skipped_count":%s,"filesystem_bytes":%s,"filesystem_inodes":%s,"deletion_executed":true,"plan_consumed":true,"secrets_included":false}\n' \
    "$TOOL_VERSION" "$POLICY_VERSION" "$PLAN_ID" "$PLAN_HASH_META" "$deleted_count" "$deleted_bytes" "$skipped_count" "$bytes_snapshot" "$inode_snapshot"
}

reserve_status_action() {
  local exists=false size=0 mtime=0 inode=0 token=""
  if [[ -f "$RESERVE_FILE" && ! -L "$RESERVE_FILE" ]]; then
    exists=true
    size="$(stat -c '%s' -- "$RESERVE_FILE")"
    mtime="$(stat -c '%Y' -- "$RESERVE_FILE")"
    inode="$(stat -c '%i' -- "$RESERVE_FILE")"
    token="RELEASE_HOSTINGER_STORAGE_RESERVE:$(sha256_text "$size:$mtime:$inode:$POLICY_VERSION")"
  fi
  printf '{"ok":true,"action":"reserve-status","exists":%s,"size_bytes":%s,"release_confirmation":"%s","deletion_executed":false,"secrets_included":false}\n' \
    "$exists" "$size" "$token"
}

reserve_create_action() {
  acquire_lock
  [[ ! -e "$RESERVE_FILE" ]] || fail reserve_already_exists "emergency reserve already exists"
  local expected="PROVISION_HOSTINGER_STORAGE_RESERVE:$RESERVE_BYTES"
  [[ "$CONFIRMATION" == "$expected" ]] || fail confirmation_mismatch "reserve confirmation must equal $expected"
  local blocks=$(( (RESERVE_BYTES + 1048575) / 1048576 ))
  dd if=/dev/zero of="$RESERVE_FILE" bs=1048576 count="$blocks" status=none conv=fsync
  truncate -s "$RESERVE_BYTES" -- "$RESERVE_FILE"
  chmod 600 -- "$RESERVE_FILE"
  printf '{"ok":true,"action":"reserve-create","size_bytes":%s,"purpose":"emergency_metadata_and_hpanel_recovery","deletion_executed":false,"secrets_included":false}\n' "$RESERVE_BYTES"
}

reserve_release_action() {
  acquire_lock
  [[ -f "$RESERVE_FILE" && ! -L "$RESERVE_FILE" ]] || fail reserve_not_found "emergency reserve does not exist"
  local size mtime inode expected
  size="$(stat -c '%s' -- "$RESERVE_FILE")"
  mtime="$(stat -c '%Y' -- "$RESERVE_FILE")"
  inode="$(stat -c '%i' -- "$RESERVE_FILE")"
  expected="RELEASE_HOSTINGER_STORAGE_RESERVE:$(sha256_text "$size:$mtime:$inode:$POLICY_VERSION")"
  [[ "$CONFIRMATION" == "$expected" ]] || fail confirmation_mismatch "reserve release confirmation does not match reserve-status"
  rm -- "$RESERVE_FILE"
  printf '{"ok":true,"action":"reserve-release","released_bytes":%s,"deletion_executed":true,"reserve_only":true,"secrets_included":false}\n' "$size"
}

case "$ACTION" in
  scan) scan_action ;;
  plan) plan_action ;;
  inspect) inspect_action ;;
  apply) apply_action ;;
  reserve-status) reserve_status_action ;;
  reserve-create) reserve_create_action ;;
  reserve-release) reserve_release_action ;;
  *) fail unsupported_action "unsupported action: $ACTION" ;;
esac
