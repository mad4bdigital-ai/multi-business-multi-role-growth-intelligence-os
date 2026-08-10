import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github/workflows/tenant-request-identity-collation-authorize-dry-run.yml');
const runnerPath = path.join(root, '.github/ops/tenant-request-identity-collation-authorize-dry-run.mjs');
const readinessPath = path.join(root, '.github/ops/tenant-request-identity-collation-runtime-readiness.mjs');

const [workflow, runner, readiness] = await Promise.all([
  fs.readFile(workflowPath, 'utf8'),
  fs.readFile(runnerPath, 'utf8'),
  fs.readFile(readinessPath, 'utf8'),
]);

const token = 'AUTHORIZE_GOVERNED_MIGRATION_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';
const migration = '20260808_tenant_request_identity_collation_alignment.sql';
const checksum = 'cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7';
const blob = '5f68a02f351a4cf80fa89a826abe3c92412f7079';
const sourceMerge = '894f112c452887e9c8f3f58fe55af598cb04af31';

assert.match(workflow, /issue_comment:\s*\n\s*types:\s*\[created\]/);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.ok(workflow.includes(`github.event.comment.body == '${token}'`));
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.ok(workflow.indexOf('Re-verify same-cycle read-only readiness') < workflow.indexOf('Bootstrap authorization and execute Dry Run only'));
assert.ok(workflow.includes('tenant-request-identity-collation-runtime-readiness.mjs'));
assert.ok(workflow.includes('tenant-request-identity-collation-authorize-dry-run.mjs'));
assert.ok(!workflow.includes('APPLY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT'));
assert.ok(!workflow.includes('mode: apply'));
assert.ok(!workflow.includes("mode: 'apply'"));
assert.ok(!workflow.includes('1043'));

assert.ok(runner.includes(`const MIGRATION = '${migration}'`));
assert.ok(runner.includes(`const MIGRATION_BLOB_SHA = '${blob}'`));
assert.ok(runner.includes(`const CHECKSUM = '${checksum}'`));
assert.ok(runner.includes('const STATEMENT_COUNT = 3'));
assert.ok(runner.includes(`const SOURCE_MERGE_SHA = '${sourceMerge}'`));
assert.ok(runner.includes(`const AUTH_CONFIRM = '${token}'`));
assert.ok(runner.includes("name: 'governed_migration_authorization_bootstrap'"));
assert.ok(runner.includes("name: 'governed_migration_execute'"));
assert.ok(runner.includes("mode: 'dry_run'"));
assert.ok(runner.includes("assert.equal(result?.applies_sql, false)"));
assert.ok(runner.includes("assert.equal(Number(result?.preflight_risk_count || 0), 0)"));
assert.ok(runner.includes('refusing to replay the one-shot Dry Run authorization'));
assert.ok(!runner.includes("mode: 'apply'"));
assert.ok(!runner.includes('APPLY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT'));
assert.ok(!runner.includes('governed_migration_execute_apply'));
assert.ok(!runner.includes('capability_resolution_envelope_apply_authorize'));
assert.ok(!runner.includes('provider_call'));
assert.ok(!runner.includes('mysql'));
assert.ok(!runner.includes('db.query'));
assert.ok(!runner.includes('1043'));

assert.ok(readiness.includes(`const MIGRATION = '${migration}'`));
assert.ok(readiness.includes(`const MIGRATION_BLOB_SHA = '${blob}'`));
assert.ok(readiness.includes(`const CHECKSUM = '${checksum}'`));
assert.ok(readiness.includes('const STATEMENT_COUNT = 3'));
assert.ok(readiness.includes(`const SOURCE_MERGE_SHA = '${sourceMerge}'`));
assert.ok(readiness.includes("result: 'ready_to_authorize_dry_run'"));

process.stdout.write(JSON.stringify({
  contract: 'tenant_request_identity_collation_authorize_dry_run_contract.v1',
  result: 'pass',
  issue: 4449,
  source_pr: 6662,
  migration,
  checksum,
  statement_count: 3,
  apply_surface_present: false,
  direct_sql_surface_present: false,
  migration_1043_touched: false,
  secrets_included: false,
}) + '\n');
