import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const workflow = read('../.github/workflows/github-repository-policy-1050-governed-rollout.yml');
const runner = read('../.github/ops/github-repository-policy-1050-governed-rollout.mjs');
const migration = read('./migrations/1050_github_repository_policy_controller_bootstrap_repair.sql');

assert.match(workflow, /^name: Governed Migration 1050 GitHub Repository Policy Bootstrap Repair Rollout/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /issues:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 6628/g);
assert.equal((workflow.match(/SOURCE_PR: '6746'/g) || []).length, 3, 'All rollout phases must bind to final rollout PR #6746');
assert.match(workflow, /AUTHORIZE_GOVERNED_MIGRATION_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /APPLY_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /VERIFY_GOVERNED_MIGRATION_1050_GITHUB_REPOSITORY_POLICY_CONTROLLER_BOOTSTRAP_REPAIR/);
assert.match(workflow, /persist-credentials: false/g);
assert.doesNotMatch(workflow, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);

assert.match(runner, /const SOURCE_PR = Number\(process\.env\.SOURCE_PR \|\| 6746\);/);
assert.match(runner, /const UPSTREAM_REPAIR_PR = 6629;/);
assert.match(runner, /const UPSTREAM_REPAIR_MERGE_SHA = '5505adde1bf29125c56d8588cf8de3ee956c819c';/);
assert.match(runner, /const MIGRATION_BLOB_SHA = '06a2ddde04f6feafefae1cc1cef69dbc6fdadd3f';/);
assert.match(runner, /const EXPECTED_STATEMENT_COUNT = 7;/);
assert.match(runner, /Rollout source PR #\$\{SOURCE_PR\} is not merged/);
assert.match(runner, /sourceMergeSha = actual/);
assert.match(runner, /Rollout source merge does not contain upstream repair lineage/);
assert.match(runner, /Production does not contain canonical Migration 1050 rollout merge/);
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
assert.match(runner, /Exact Migration 1050 apply ledger was not proven; Apply was not retried/);
assert.match(runner, /governed_migration_authorization_bootstrap/);
assert.match(runner, /capability_resolution_envelope_apply_authorize/);
const migration1050ReadinessEnvelopeDecisionNote = 'Approve checksum-bound Migration 1050 authorization only, with no SQL, Migration 1049 retry, or GitHub provider mutation executing in readiness.';
assert.ok(runner.includes(migration1050ReadinessEnvelopeDecisionNote), 'Migration 1050 readiness envelope must use the canonical shell-safe decision note');
for (const forbidden of [';', '&', '|', '`', '$', '<', '>']) {
  assert.equal(migration1050ReadinessEnvelopeDecisionNote.includes(forbidden), false, `Migration 1050 readiness envelope decision note contains forbidden shell metacharacter: ${forbidden}`);
}
assert.doesNotMatch(runner, /Approve checksum-bound Migration 1050 authorization only; no SQL/);
assert.match(runner, /buildAdminControlDbReadRequest/);
assert.match(runner, /metadata\.migration_checksum_sha256/);
assert.match(runner, /metadata\.expected_statement_count/);
assert.match(runner, /metadata\.pull_request/);
assert.match(runner, /metadata\.merge_sha/);
assert.match(runner, /const authorization = await durableAuthorizationReadback\(\);/g);
assert.match(runner, /migration_binding_summary: authorization/g);
assert.match(runner, /migration_binding_summary: reconciled\.authorization/);
assert.match(runner, /SAFE_EVIDENCE_KEYS = new Set\(\['authorization_status',/);
assert.match(runner, /SAFE_EVIDENCE_KEYS\.has\('authorization'\), false/);
assert.doesNotMatch(runner, /SAFE_EVIDENCE_KEYS = new Set\(\[[^\]]*['"]authorization['"]/);
assert.match(runner, /sensitiveKey\.test\(key\) && !SAFE_EVIDENCE_KEYS\.has\(key\) \? '\[redacted\]' : sanitize\(child\)/);
assert.doesNotMatch(runner, /1049_github_repository_policy_single_owner_mode\.sql['"]\s*,\s*mode:\s*['"]apply/);
assert.doesNotMatch(runner, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);

assert.match(migration, /metadata_json=JSON_MERGE_PATCH\(CASE WHEN JSON_VALID\(metadata_json\) THEN metadata_json ELSE JSON_OBJECT\(\) END, VALUES\(metadata_json\)\)/);
assert.doesNotMatch(migration, /allow_apply=VALUES\(allow_apply\),notes=VALUES\(notes\),metadata_json=VALUES\(metadata_json\)/);

console.log('github repository policy Migration 1050 governed rollout contract tests passed');