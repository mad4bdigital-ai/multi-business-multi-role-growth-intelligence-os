#!/usr/bin/env bash
set -euo pipefail

on_error() {
  local rc="$1"
  local line="$2"
  local command="$3"
  trap - ERR
  set +x
  set +e
  echo "::error title=Work Map builder failure::rc=${rc} line=${line} command=${command}"
  if [[ -n "${GH_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "${PR_NUMBER:-}" ]]; then
    local body
    body=$(cat <<EOF
Temporary Work Map builder diagnostic — never-merge surface

- Run: `${GITHUB_RUN_ID:-unknown}`
- Exit code: `${rc}`
- Script line: `${line}`
- Failed command:

```bash
${command}
```

No candidate branch was accepted from this failed run.
EOF
)
    gh api --method POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$body" >/dev/null || true
  fi
  exit "$rc"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR
PS4='+${BASH_SOURCE}:${LINENO}: '
set -x

EXPECTED_MAIN_SHA="${EXPECTED_MAIN_SHA:?}"
OLD_BASE_SHA="${OLD_BASE_SHA:?}"
CANDIDATE_SHA="${CANDIDATE_SHA:?}"
TARGET_BRANCH="${TARGET_BRANCH:?}"

source_paths=(
  .changes/e2e/work-map-post-write-exact-verification-dispatch.json
  .github/workflows/ci.yml
  .github/workflows/spec-kit-work-map-autofix.yml
  .github/workflows/spec-kit-work-map-integration.yml
  http-generic-api/test-work-map-post-write-exact-verification-dispatch.mjs
)

git fetch origin main "${OLD_BASE_SHA}" "${CANDIDATE_SHA}"
test "$(git rev-parse origin/main)" = "${EXPECTED_MAIN_SHA}"
if git ls-remote --exit-code origin "refs/heads/${TARGET_BRANCH}" >/dev/null 2>&1; then
  echo "Target branch already exists; refusing overwrite."
  exit 1
fi

git checkout --detach "${EXPECTED_MAIN_SHA}"
git switch -c "${TARGET_BRANCH}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Apply only the reviewed source delta, preserving all non-overlapping changes
# that reached main after the original candidate base.
for path in "${source_paths[@]}"; do
  patch="$RUNNER_TEMP/$(printf '%s' "$path" | tr '/.' '__').patch"
  git diff "${OLD_BASE_SHA}" "${CANDIDATE_SHA}" -- "$path" > "$patch"
  test -s "$patch"
  git apply --3way "$patch"
done

# Preserve the current Recovery Bridge registry rows while importing only the
# reviewed Writer V3 command contract from the stale candidate.
git show "${CANDIDATE_SHA}:.specify/pipeline-connectivity-contract.json" > "$RUNNER_TEMP/candidate-contract.json"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const path = '.specify/pipeline-connectivity-contract.json';
const current = JSON.parse(fs.readFileSync(path, 'utf8'));
const candidate = JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP + '/candidate-contract.json', 'utf8'));
const currentPolicy = current.artifact_writer_policies.find((row) => row.key === 'platform-work-maps-sole-remote-writer');
const candidatePolicy = candidate.artifact_writer_policies.find((row) => row.key === 'platform-work-maps-sole-remote-writer');
const currentWriter = current.pipelines.find((row) => row.key === 'spec-kit-work-map-autofix');
const candidateWriter = candidate.pipelines.find((row) => row.key === 'spec-kit-work-map-autofix');
if (!currentPolicy || !candidatePolicy || !currentWriter || !candidateWriter) {
  throw new Error('Work Map writer contract missing');
}
currentPolicy.required_writer_commands = candidatePolicy.required_writer_commands;
currentPolicy.forbidden_writer_commands = candidatePolicy.forbidden_writer_commands;
currentWriter.required_commands = candidateWriter.required_commands;
currentWriter.forbidden_commands = candidateWriter.forbidden_commands;
fs.writeFileSync(path, JSON.stringify(current, null, 2) + '\n');
NODE

# Merge the Writer V3 regression hunks over the current Recovery Bridge tests.
git diff "${OLD_BASE_SHA}" "${CANDIDATE_SHA}" -- http-generic-api/test-pipeline-connectivity-check.mjs > "$RUNNER_TEMP/pipeline-test.patch"
test -s "$RUNNER_TEMP/pipeline-test.patch"
git apply --3way "$RUNNER_TEMP/pipeline-test.patch"

# Close the E2E governance omission found on the stale candidate.
node --input-type=module <<'NODE'
import fs from 'node:fs';
const path = '.changes/e2e/work-map-post-write-exact-verification-dispatch.json';
const contract = JSON.parse(fs.readFileSync(path, 'utf8'));
contract.merge_contract = { minimum_phase: 'mvp' };
fs.writeFileSync(path, JSON.stringify(contract, null, 2) + '\n');
NODE

# The current-main input-driven branch hardening must survive reconstruction.
grep -F '[[ "${TARGET_BRANCH}" != refs/* ]]' .github/workflows/spec-kit-work-map-autofix.yml
if grep -Eq '\^\(gpt\|cert\|fix\|feat\|chore\|docs\|release\)/' .github/workflows/spec-kit-work-map-autofix.yml; then
  echo "Stale permanent branch namespace allowlist reintroduced."
  exit 1
fi

test -z "$(git ls-files -u)"
git diff --check
git diff --name-only "${EXPECTED_MAIN_SHA}" | sort > "$RUNNER_TEMP/actual.txt"
printf '%s\n' \
  .changes/e2e/work-map-post-write-exact-verification-dispatch.json \
  .github/workflows/ci.yml \
  .github/workflows/spec-kit-work-map-autofix.yml \
  .github/workflows/spec-kit-work-map-integration.yml \
  .specify/pipeline-connectivity-contract.json \
  http-generic-api/test-pipeline-connectivity-check.mjs \
  http-generic-api/test-work-map-post-write-exact-verification-dispatch.mjs | sort > "$RUNNER_TEMP/expected.txt"
diff -u "$RUNNER_TEMP/expected.txt" "$RUNNER_TEMP/actual.txt"

GITHUB_BASE_SHA="${EXPECTED_MAIN_SHA}" GITHUB_HEAD_SHA=HEAD node http-generic-api/test-pipeline-connectivity-check.mjs
node http-generic-api/test-work-map-post-write-exact-verification-dispatch.mjs
node http-generic-api/scripts/pipeline-connectivity-check.mjs
GITHUB_BASE_SHA="${EXPECTED_MAIN_SHA}" GITHUB_HEAD_SHA=HEAD node http-generic-api/scripts/e2e-phase-governance.mjs

test "$(git rev-parse origin/main)" = "${EXPECTED_MAIN_SHA}"
git add \
  .changes/e2e/work-map-post-write-exact-verification-dispatch.json \
  .github/workflows/ci.yml \
  .github/workflows/spec-kit-work-map-autofix.yml \
  .github/workflows/spec-kit-work-map-integration.yml \
  .specify/pipeline-connectivity-contract.json \
  http-generic-api/test-pipeline-connectivity-check.mjs \
  http-generic-api/test-work-map-post-write-exact-verification-dispatch.mjs
git commit -m "fix(ci): make Work Map verification observable and exact"
result_sha="$(git rev-parse HEAD)"
test "$(git rev-parse HEAD^)" = "${EXPECTED_MAIN_SHA}"
git push origin "HEAD:refs/heads/${TARGET_BRANCH}"
test "$(git ls-remote --exit-code origin "refs/heads/${TARGET_BRANCH}" | awk '{print $1}')" = "${result_sha}"
echo "RESULT_HEAD_SHA=${result_sha}" >> "$GITHUB_STEP_SUMMARY"
