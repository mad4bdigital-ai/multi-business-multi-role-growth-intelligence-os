import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/transport-response-schema-1048-governed-rollout.yml', import.meta.url),
  'utf8',
);
const runner = readFileSync(
  new URL('../.github/ops/transport-response-schema-1048-governed-rollout.mjs', import.meta.url),
  'utf8',
);

for (const expected of [
  'github.event.issue.number == 6531',
  "AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",
  "APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",
  "VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",
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

console.log('PASS governed Migration 1048 rollout contract');
