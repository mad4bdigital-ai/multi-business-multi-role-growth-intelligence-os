import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';

const workflow = await fs.readFile('../.github/workflows/response-chunk-ownership-governed-rollout.yml', 'utf8');
const runner = await fs.readFile('../.github/ops/response-chunk-ownership-governed-rollout.mjs', 'utf8');
const runtimeClosure = await fs.readFile('../.github/ops/response-chunk-ownership-runtime-closure.mjs', 'utf8');
const manifest = await fs.readFile('./scripts/test-manifest.mjs', 'utf8');
const migration = await fs.readFile('./migrations/20260728_governed_response_chunk_ownership.sql', 'utf8');

assert.match(workflow, /issue_comment:/);
assert.match(workflow, /github\.event\.issue\.number == 4191/);
assert.match(workflow, /AUTHORIZE_GOVERNED_RESPONSE_CHUNK_OWNERSHIP_ROLLOUT/);
assert.match(workflow, /APPLY_GOVERNED_RESPONSE_CHUNK_OWNERSHIP_ROLLOUT/);
assert.match(workflow, /VERIFY_GOVERNED_RESPONSE_CHUNK_OWNERSHIP_RUNTIME/);
assert.match(workflow, /cancel-in-progress: false/g);
assert.match(workflow, /ref: main/g);
assert.match(workflow, /response-chunk-ownership-readiness-/);
assert.match(workflow, /response-chunk-ownership-apply-/);
assert.match(workflow, /response-chunk-ownership-runtime-closure-/);

assert.match(runner, /MIGRATION_BLOB_SHA = '930b29dbf9f3d360ef6f76b52427585c31fa37a0'/);
assert.match(runner, /SOURCE_MERGE_SHA = 'd21c26fbb94a857b4727b583df74e2aab54303cc'/);
assert.match(runner, /splitMigrationSqlStatements/);
assert.match(runner, /verifyProductionMigrationBlob/);
assert.match(runner, /readback_first/);
assert.match(runner, /same_cycle_dry_run/);
assert.match(runner, /single_apply_request/);
assert.match(runner, /Deliberately no Apply retry/);
assert.match(runner, /apply_retried: false/);
assert.match(runner, /present_column_count\), 6/);
assert.match(runner, /present_index_count\), 2/);
assert.match(runner, /readiness_status, 'ready'/);
assert.match(runner, /legacy_rows_backfilled\), 0/);
assert.match(runner, /provider_call_executed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /secrets_included: false/);

assert.match(runtimeClosure, /SOURCE_MERGE = 'd21c26fbb94a857b4727b583df74e2aab54303cc'/);
assert.match(runtimeClosure, /Production moved during runtime closure/);
assert.match(runtimeClosure, /response_chunk_durable_recovery_smoke/);
assert.match(runtimeClosure, /RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE/);
assert.match(runtimeClosure, /exact_unicode_reconstruction/);
assert.match(runtimeClosure, /sliding_extension_verified/);
assert.match(runtimeClosure, /external_business_writes: 0/);
assert.match(runtimeClosure, /secrets_included: false/);

assert.match(migration, /requires_migration_first_rollout/);
assert.match(migration, /legacy_backfill',FALSE/);
assert.match(migration, /'high',0,1,1/);
assert.match(manifest, /node test-response-chunk-ownership-governed-rollout-control\.mjs/);

console.log('response chunk ownership governed rollout control contract: pass');
