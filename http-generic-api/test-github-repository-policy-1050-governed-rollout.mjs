import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const workflow = read('../.github/workflows/github-repository-policy-1050-governed-rollout.yml');
const runner = read('../.github/ops/github-repository-policy-1050-governed-rollout.mjs');

assert.match(workflow, /^name: Governed Migration 1050 GitHub Repository Policy Bootstrap Repair Rollout/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /issues:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 6628/g);
assert.match(workflow, /SOURCE_PR: '6629'/);
assert.match(workflow, /AUTHORIZE_GOVERNED_MIGRATION_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /APPLY_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /VERIFY_GOVERNED_MIGRATION_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /persist-credentials: false/g);
assert.doesNotMatch(workflow, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);

assert.match(runner, /const MIGRATION_BLOB_SHA = '571fab72a305a209fa19e7b0711d87cd4eae483c';/);
assert.match(runner, /const SOURCE_MERGE_SHA = '5505adde1bf29125c56d8588cf8de3ee956c819c';/);
assert.match(runner, /const EXPECTED_STATEMENT_COUNT = 7;/);
assert.match(runner, /assert\.equal\(actual, SOURCE_MERGE_SHA/);
assert.match(runner, /Buffer\.from\(String\(file\.content \|\| ''\)\.replace\(\/\\s\+\/g, ''\), 'base64'\)/);
assert.match(runner, /assert\.equal\(gitBlobSha\(bytes\), MIGRATION_BLOB_SHA/);
assert.match(runner, /checksum = sha256Bytes\(bytes\)/);
assert.match(runner, /raw_bytes_checksum: true/);

assert.equal((runner.match(/name: 'governed_migration_execute'/g) || []).length, 2, 'Migration 1050 runner must contain one dry-run and one Apply transport call');
assert.match(runner, /apply_retried: false/g);
assert.match(runner, /migration_1049_retry_executed: false/g);
assert.match(runner, /live_github_policy_apply: false/g);
assert.match(runner, /provider_call_executed: false/g);
assert.match(runner, /external_write_executed: false/g);
assert.match(runner, /Production does not contain canonical Migration 1050 source merge/);
assert.match(runner, /Production Migration 1050 blob mismatch/);
assert.match(runner, /Exact Migration 1050 apply ledger was not proven; Apply was not retried/);
assert.match(runner, /governed_migration_authorization_bootstrap/);
assert.match(runner, /capability_resolution_envelope_apply_authorize/);
assert.match(runner, /buildAdminControlDbReadRequest/);
assert.doesNotMatch(runner, /1049_github_repository_policy_single_owner_mode\.sql['"]\s*,\s*mode:\s*['"]apply/);
assert.doesNotMatch(runner, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);

console.log('github repository policy Migration 1050 governed rollout contract tests passed');
