#!/usr/bin/env bash
set -Eeuo pipefail

: "${INTEGRATION_SHA:?INTEGRATION_SHA is required}"
: "${MAIN_SHA:?MAIN_SHA is required}"
: "${FINAL_BRANCH:?FINAL_BRANCH is required}"
: "${REPORT_DIR:?REPORT_DIR is required}"

EXPECTED_CONFLICT='http-generic-api/frontend-surface-dispatch.generated.json'
ALLOWED_GENERATED=(
  'http-generic-api/frontend-operation-governance.generated.json'
  'http-generic-api/frontend-surface-dispatch.generated.json'
  'http-generic-api/openapi/frontend-runtime-routes.generated.yaml'
)

mkdir -p "$REPORT_DIR"
: > "$REPORT_DIR/conflict-paths.txt"
: > "$REPORT_DIR/generator-changed-files.txt"

stage='initialized'
candidate_sha=''
first_parent=''
second_parent=''
error_command=''

write_report() {
  local outcome="$1"
  local exit_code="$2"
  OUTCOME="$outcome" EXIT_CODE="$exit_code" STAGE="$stage" CANDIDATE_SHA="$candidate_sha" \
    FIRST_PARENT="$first_parent" SECOND_PARENT="$second_parent" ERROR_COMMAND="$error_command" \
    python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

report_dir = Path(os.environ['REPORT_DIR'])
conflicts = [line.strip() for line in (report_dir / 'conflict-paths.txt').read_text().splitlines() if line.strip()]
generated = [line.strip() for line in (report_dir / 'generator-changed-files.txt').read_text().splitlines() if line.strip()]
report = {
    'contract': 'spec014.main-sync-reconciliation-builder.v1',
    'outcome': os.environ['OUTCOME'],
    'stage': os.environ['STAGE'],
    'exit_code': int(os.environ['EXIT_CODE']),
    'integration_sha': os.environ['INTEGRATION_SHA'],
    'main_sha': os.environ['MAIN_SHA'],
    'expected_conflict_path': 'http-generic-api/frontend-surface-dispatch.generated.json',
    'conflict_paths': conflicts,
    'conflict_set_sha256': hashlib.sha256('\n'.join(conflicts).encode()).hexdigest(),
    'generator_changed_files': generated,
    'candidate_sha': os.environ['CANDIDATE_SHA'] or None,
    'first_parent': os.environ['FIRST_PARENT'] or None,
    'second_parent': os.environ['SECOND_PARENT'] or None,
    'final_branch': os.environ['FINAL_BRANCH'],
    'error_command': os.environ['ERROR_COMMAND'] or None,
    'repository_mutation_performed': os.environ['OUTCOME'] == 'passed',
    'remote_ref_updated': os.environ['OUTCOME'] == 'passed',
    'force_push_performed': False,
    'main_mutated': False,
    'production_mutated': False,
    'migration_apply_performed': False,
    'live_database_access_performed': False,
    'provider_dispatch_performed': False,
    'job_logs_consulted': False,
    'secrets_included': False,
}
(report_dir / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
lines = [
    '## Spec 014 main synchronization reconciliation builder',
    '',
    f"- Outcome: **{report['outcome']}**",
    f"- Stage: `{report['stage']}`",
    f"- Exit code: `{report['exit_code']}`",
    f"- Integration SHA: `{report['integration_sha']}`",
    f"- Main SHA: `{report['main_sha']}`",
    f"- Candidate SHA: `{report['candidate_sha']}`",
    f"- First parent: `{report['first_parent']}`",
    f"- Second parent: `{report['second_parent']}`",
    f"- Final branch: `{report['final_branch']}`",
    f"- Conflict-set SHA-256: `{report['conflict_set_sha256']}`",
    f"- Error command: `{report['error_command']}`",
    '- Force push performed: `false`',
    '- main mutated: `false`',
    '- Production mutated: `false`',
    '- Migration apply performed: `false`',
    '- Live database access performed: `false`',
    '- Provider dispatch performed: `false`',
    '- Job logs consulted: `false`',
    '- Secrets included: `false`',
    '',
    '### Conflict paths',
    '',
]
lines.extend([f'- `{item}`' for item in conflicts] or ['- None'])
lines.extend(['', '### Generator write set', ''])
lines.extend([f'- `{item}`' for item in generated] or ['- None'])
(report_dir / 'summary.md').write_text('\n'.join(lines) + '\n')
PY
}

on_error() {
  local rc=$?
  error_command="${BASH_COMMAND}"
  write_report 'failed' "$rc"
  exit "$rc"
}
trap on_error ERR
write_report 'running' 0

stage='fetch_exact_inputs'
git fetch --no-tags origin "$INTEGRATION_SHA" "$MAIN_SHA"
test "$(git rev-parse "${INTEGRATION_SHA}^{commit}")" = "$INTEGRATION_SHA"
test "$(git rev-parse "${MAIN_SHA}^{commit}")" = "$MAIN_SHA"

stage='checkout_exact_integration'
git checkout --detach "$INTEGRATION_SHA"
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git update-ref refs/heads/main "$MAIN_SHA"

stage='merge_exact_main_without_commit'
set +e
git -c merge.conflictStyle=diff3 merge --no-commit --no-ff "$MAIN_SHA" \
  >"$REPORT_DIR/merge.stdout.txt" \
  2>"$REPORT_DIR/merge.stderr.txt"
merge_exit_code=$?
set -e
test "$merge_exit_code" = '1'
git diff --name-only --diff-filter=U | LC_ALL=C sort > "$REPORT_DIR/conflict-paths.txt"
test "$(wc -l < "$REPORT_DIR/conflict-paths.txt" | tr -d ' ')" = '1'
test "$(cat "$REPORT_DIR/conflict-paths.txt")" = "$EXPECTED_CONFLICT"

stage='resolve_generated_conflict_seed'
git checkout --theirs -- "$EXPECTED_CONFLICT"
git add "$EXPECTED_CONFLICT"
test -z "$(git diff --name-only --diff-filter=U)"
test -z "$(git diff --name-only)"

stage='install_dependencies'
npm ci --prefix http-generic-api

stage='regenerate_frontend_dispatch'
npm --prefix http-generic-api run frontend:dispatch:generate -- --baseline-ref=main
git diff --name-only | LC_ALL=C sort > "$REPORT_DIR/generator-changed-files.txt"
while IFS= read -r changed; do
  [[ -z "$changed" ]] && continue
  allowed='false'
  for candidate in "${ALLOWED_GENERATED[@]}"; do
    if [[ "$changed" == "$candidate" ]]; then
      allowed='true'
      break
    fi
  done
  test "$allowed" = 'true'
done < "$REPORT_DIR/generator-changed-files.txt"
grep -Fxq "$EXPECTED_CONFLICT" "$REPORT_DIR/generator-changed-files.txt"

stage='verify_generated_artifacts'
npm --prefix http-generic-api run frontend:dispatch:check
node http-generic-api/test-frontend-operation-governance-generator.mjs
node http-generic-api/test-frontend-surface-dispatch.mjs
node http-generic-api/test-frontend-auth-openapi-parity.mjs
node http-generic-api/test-openapi-route-coverage.mjs

stage='stage_generated_resolution'
git add "${ALLOWED_GENERATED[@]}"
test -z "$(git diff --name-only --diff-filter=U)"
git diff --cached --check

stage='create_merge_commit'
git commit -m 'chore(sync): reconcile current main into Spec 014 Integration'
candidate_sha="$(git rev-parse HEAD)"
first_parent="$(git rev-parse HEAD^1)"
second_parent="$(git rev-parse HEAD^2)"
test "$first_parent" = "$INTEGRATION_SHA"
test "$second_parent" = "$MAIN_SHA"
test -z "$(git status --porcelain --untracked-files=all)"

stage='verify_final_branch_absent'
set +e
git ls-remote --exit-code --heads origin "$FINAL_BRANCH" >/dev/null 2>&1
remote_status=$?
set -e
test "$remote_status" = '2'

stage='push_final_branch'
git push origin "HEAD:refs/heads/${FINAL_BRANCH}"

stage='completed'
write_report 'passed' 0
