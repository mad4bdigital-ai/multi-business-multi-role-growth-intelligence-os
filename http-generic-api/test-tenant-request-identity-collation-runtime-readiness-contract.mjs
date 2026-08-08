import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/tenant-request-identity-collation-runtime-readiness.yml', 'utf8');
const runner = readFileSync('../.github/ops/tenant-request-identity-collation-runtime-readiness.mjs', 'utf8');
const dbBuilder = readFileSync('../.github/ops/lib/admin-control-db-request.mjs', 'utf8');
const migration = readFileSync('migrations/20260808_tenant_request_identity_collation_alignment.sql', 'utf8');

assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.match(workflow, /VERIFY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_READINESS/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /Checkout trusted default branch/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /tenant-request-identity-collation-runtime-readiness\.mjs/);
assert.doesNotMatch(workflow, /workflow_dispatch:/);

assert.match(runner, /buildAdminControlDbReadRequest/);
assert.match(runner, /20260808_tenant_request_identity_collation_alignment\.sql/);
assert.match(runner, /5f68a02f351a4cf80fa89a826abe3c92412f7079/);
assert.match(runner, /cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7/);
assert.match(runner, /const STATEMENT_COUNT = 3/);
assert.match(runner, /CHARACTER_SET_NAME, COLLATION_NAME/);
assert.match(runner, /TABLE_COLLATION/);
assert.match(runner, /tenant_resolution_cases'.*resource_ref/s);
assert.match(runner, /governed_migration_ledger/);
assert.match(runner, /blocked_on_production_promotion/);
assert.match(runner, /ready_to_authorize_dry_run/);
assert.match(runner, /already_applied_verified/);
assert.match(runner, /readback_only: true/);
assert.match(runner, /apply_authorized: false/);
assert.match(runner, /apply_sent: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.doesNotMatch(runner, /governed_migration_execute/);
assert.doesNotMatch(runner, /capability_resolution_envelope_(?:create|approve)/);
assert.doesNotMatch(runner, /APPLY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT/);

assert.match(dbBuilder, /read_only: true/);
assert.match(dbBuilder, /tool: contract\.tool/);
assert.match(dbBuilder, /action: contract\.request\.action/);
assert.match(dbBuilder, /\[contract\.request\.sql_field\]: sql/);

assert.match(migration, /ALTER TABLE `ticket_lifecycle_events`/);
assert.match(migration, /ALTER TABLE `tenant_resolution_cases`/);
assert.doesNotMatch(migration, /resource_ref/i);

console.log('tenant request identity collation runtime readiness contract tests passed');
