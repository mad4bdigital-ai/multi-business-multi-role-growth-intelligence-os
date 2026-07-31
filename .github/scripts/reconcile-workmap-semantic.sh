#!/usr/bin/env bash
set -euo pipefail

EXPECTED_WORKMAP_HEAD="093e90e8994390b794c1f64ccc8db67e90f8399a"
EXPECTED_MAIN_HEAD="06e356d8ff47962311c7dc5667416a1966e1ce08"
TARGET_BRANCH="gpt/spec-kit-work-map-integration-fabric-20260731"

cp .github/scripts/compose-test-runner-sharding.py /tmp/compose-test-runner-sharding.py

git config user.name "workmap-semantic-reconcile[bot]"
git config user.email "workmap-semantic-reconcile[bot]@users.noreply.github.com"
git fetch --no-tags origin \
  "main:refs/remotes/origin/main" \
  "${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}"
git checkout -B workmap-semantic-reconcile "refs/remotes/origin/${TARGET_BRANCH}"

actual_workmap="$(git rev-parse HEAD)"
actual_main="$(git rev-parse refs/remotes/origin/main)"
[[ "$actual_workmap" == "$EXPECTED_WORKMAP_HEAD" ]] || {
  echo "Work Map head moved: expected $EXPECTED_WORKMAP_HEAD, got $actual_workmap" >&2
  exit 1
}
[[ "$actual_main" == "$EXPECTED_MAIN_HEAD" ]] || {
  echo "main moved: expected $EXPECTED_MAIN_HEAD, got $actual_main" >&2
  exit 1
}

set +e
git merge --no-ff --no-commit refs/remotes/origin/main
merge_status=$?
set -e
if [[ $merge_status -ne 0 ]]; then
  conflicts="$(git diff --name-only --diff-filter=U | sort)"
  expected_conflicts="$(printf '%s\n' \
    '.github/workflows/ci.yml' \
    'docs/work-maps/README.md' \
    'docs/work-maps/data-model-domain-map.md' \
    'docs/work-maps/repository-automation-map.md' \
    'docs/work-maps/work-map-coverage-matrix.md' \
    'http-generic-api/scripts/run-test-manifest.mjs')"
  [[ "$conflicts" == "$expected_conflicts" ]] || {
    echo "Unexpected conflict set:" >&2
    printf '%s\n' "$conflicts" >&2
    git merge --abort || true
    exit 1
  }
fi

git checkout --ours .github/workflows/ci.yml
git checkout --theirs http-generic-api/scripts/run-test-manifest.mjs
git checkout --theirs \
  docs/work-maps/README.md \
  docs/work-maps/data-model-domain-map.md \
  docs/work-maps/repository-automation-map.md \
  docs/work-maps/work-map-coverage-matrix.md
python3 /tmp/compose-test-runner-sharding.py

git add \
  .github/workflows/ci.yml \
  http-generic-api/scripts/run-test-manifest.mjs \
  docs/work-maps/README.md \
  docs/work-maps/data-model-domain-map.md \
  docs/work-maps/repository-automation-map.md \
  docs/work-maps/work-map-coverage-matrix.md

test -z "$(git diff --name-only --diff-filter=U)"
node http-generic-api/scripts/platform-work-map-generator.mjs --write

node --check http-generic-api/scripts/run-test-manifest.mjs
node --check http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs
node --check http-generic-api/scripts/spec-kit-work-map-integration-gate.mjs
node --check http-generic-api/scripts/work-map-schema-classification.mjs
node http-generic-api/test-run-test-manifest-sharding.mjs
node http-generic-api/test-platform-work-map-generator.mjs
node http-generic-api/test-spec-kit-work-map-governance-gate.mjs
node http-generic-api/test-work-map-schema-classification-contract.mjs
node http-generic-api/test-work-map-schema-classification.mjs
node http-generic-api/test-pipeline-connectivity-check.mjs

git add docs/work-maps http-generic-api/scripts/run-test-manifest.mjs .github/workflows/ci.yml
git diff --check --cached

{
  git diff --name-only --cached
  git diff --name-only "refs/remotes/origin/main...${EXPECTED_WORKMAP_HEAD}"
} | sort -u > /tmp/workmap-effective-paths.txt
unexpected="$(grep -Ev '^(\.github/workflows/(ci\.yml|docs-agent\.yml|openapi-auto-sync\.yml|spec-kit-work-map-(autofix|integration)\.yml)|\.specify/|docs/(auto-docs-agent/pr-3936\.md|spec-kit-work-map-integration-governance\.md|work-maps/)|http-generic-api/(scripts/|test-))' /tmp/workmap-effective-paths.txt || true)"
[[ -z "$unexpected" ]] || {
  echo "Unexpected Work Map phase paths:" >&2
  printf '%s\n' "$unexpected" >&2
  git merge --abort || true
  exit 1
}

git commit -m "chore: reconcile Work Map governance with current main"
final_head="$(git rev-parse HEAD)"
git push origin "HEAD:refs/heads/${TARGET_BRANCH}"

cat > "$GITHUB_WORKSPACE/workmap-semantic-reconciliation.json" <<EOF
{
  "schema_version": "repository_workmap_semantic_reconciliation.v1",
  "status": "updated",
  "previous_workmap_sha": "$actual_workmap",
  "main_sha": "$actual_main",
  "final_workmap_sha": "$final_head",
  "conflict_count": 6,
  "generated_maps_rebuilt": true,
  "parallel_ci_preserved": true,
  "latest_test_catalog_preserved": true,
  "test_progress_evidence_preserved": true,
  "force_push": false,
  "main_mutated": false,
  "production_mutated": false,
  "database_mutated": false,
  "provider_call_executed": false,
  "secrets_included": false
}
EOF
