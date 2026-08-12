import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/transport-response-schema-1048-governed-rollout.yml', import.meta.url),
  'utf8',
);
const publisherWorkflow = readFileSync(
  new URL('../.github/workflows/migration-1048-readiness-evidence-publisher.yml', import.meta.url),
  'utf8',
);
const runner = readFileSync(
  new URL('../.github/ops/transport-response-schema-1048-governed-rollout.mjs', import.meta.url),
  'utf8',
);
const publisher = readFileSync(
  new URL('./scripts/migration-1048-readiness-issue-publisher.mjs', import.meta.url),
  'utf8',
);

for (const expected of [
  'github.event.issue.number == 6531',
  "AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",
  "APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",
  "VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",
  "ROLLOUT_PHASE: readiness",
  "ROLLOUT_PHASE: apply",
  "ROLLOUT_PHASE: verify",
]) {
  assert.ok(workflow.includes(expected), `Migration 1048 workflow is missing ${expected}`);
}

for (const expected of [
  "const ISSUE = Number(process.env.CONTROL_ISSUE || 6531)",
  "const MIGRATION = '1048_transport_response_chunk_schema_recovery.sql'",
  "const MIGRATION_BLOB_SHA = '496af4c64eb8225f987e0bf04827cbce4f011682'",
  'const EXPECTED_STATEMENT_COUNT = 34',
  "const SOURCE_PR = 6509",
  "const SOURCE_MERGE_SHA = '6503e74c60b8f6add9efade1f25ceb8afaec6209'",
  "const MIGRATION_CONFIRMATION_KEY = MIGRATION",
  "const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`",
  "const APPLY_CONFIRM = `APPLY_${MIGRATION_CONFIRMATION_KEY}`",
  "const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`",
  "name: 'governed_migration_execute'",
  "mode: 'dry_run'",
  "mode: 'apply'",
  "name: 'governed_migration_schema_readback'",
  'Apply was not retried',
  'apply_retried: false',
  'v_governed_response_chunk_transport_schema_readiness',
]) {
  assert.ok(runner.includes(expected), `Migration 1048 rollout runner is missing ${expected}`);
}

for (const expected of [
  'workflow_run:',
  'Governed Migration 1048 Transport Response Schema Rollout',
  'issues: write',
  'github.event.workflow_run.conclusion == \'success\'',
  'transport-response-schema-1048-readiness-${context.payload.workflow_run.id}',
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4',
  'Publish checksum-bound readiness marker to control issue',
  'migration-1048-readiness-issue-publisher.mjs',
]) {
  assert.ok(publisherWorkflow.includes(expected), `Migration 1048 publisher workflow is missing ${expected}`);
}

for (const expected of [
  "const EXPECTED_WORKFLOW = 'Governed Migration 1048 Transport Response Schema Rollout'",
  'const EXPECTED_ISSUE = 6531',
  "const READY_PREFIX = 'TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass '",
  "sourceRun?.event, 'issue_comment'",
  "sourceRun?.conclusion, 'success'",
  'sourceRun?.head_sha, sourceHeadSha',
  "summary?.result, 'ready_for_apply'",
  "summary?.authorization, 'pass'",
  "summary?.dry_run, 'pass'",
  '`production_sha=${summary.production_sha}`',
  '`migration_blob=${summary.migration_blob_sha}`',
  '`checksum=${summary.checksum}`',
  '`statement_count=${summary.statement_count}`',
  "method: 'POST'",
  'issues/${issue}/comments',
  "action: 'unchanged'",
]) {
  assert.ok(publisher.includes(expected), `Migration 1048 readiness publisher is missing ${expected}`);
}

assert.ok(!workflow.includes('issues: write'), 'The issue-comment rollout producer must remain read-only to GitHub repository metadata');
assert.ok(!workflow.includes('github.rest.issues.createComment'), 'The rollout producer must not write readiness comments directly');
assert.ok(!publisherWorkflow.includes('github.rest.issues.createComment'), 'The trusted publisher workflow must delegate issue mutation to its validated publisher module');

for (const forbidden of [
  'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
  'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
  'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
]) {
  assert.ok(!workflow.includes(forbidden), `Migration 1048 workflow retains obsolete confirmation: ${forbidden}`);
  assert.ok(!runner.includes(forbidden), `Migration 1048 runner retains obsolete confirmation: ${forbidden}`);
}

const applyModeLiterals = runner.match(/mode:\s*'apply'/g) || [];
assert.equal(
  applyModeLiterals.length,
  1,
  'Migration 1048 rollout runner must contain exactly one Apply invocation literal',
);

assert.match(
  runner,
  /const READY_SQL = `SELECT\s+/,
  'The direct database probe must be a SELECT readiness query',
);
assert.equal(
  (runner.match(/tool:\s*'db'/g) || []).length,
  1,
  'Only one direct database operation is allowed and it must be the read-only readiness probe',
);

for (const forbidden of [
  /mysql\s+-/i,
  /mariadb\s+-/i,
  /tool:\s*'db'[\s\S]{0,240}\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/i,
  /apply_retried:\s*true/i,
]) {
  assert.doesNotMatch(runner, forbidden, `Migration 1048 rollout runner violates safety contract: ${forbidden}`);
}

assert.doesNotMatch(
  runner,
  /const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY'/,
  'Authorization bootstrap must not use the Issue trigger command as its typed migration confirmation',
);
assert.doesNotMatch(
  runner,
  /const APPLY_CONFIRM = 'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY'/,
  'Migration Apply must not use the Issue trigger command as its typed executor confirmation',
);

console.log('PASS governed Migration 1048 rollout contract');
