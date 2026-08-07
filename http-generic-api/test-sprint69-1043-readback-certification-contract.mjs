import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const RUNNER_PATH = path.join(ROOT, '.github/ops/sprint69-1043-readback-certify.mjs');
const BUILDER_PATH = path.join(ROOT, '.github/ops/lib/admin-control-db-request.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/sprint69-1043-readback-certify.yml');
const E2E_PATH = path.join(ROOT, '.changes/e2e/sprint69-1043-readback-certification.json');
const CERTIFY_CONFIRM = 'CERTIFY_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE_READBACK';

const [runner, builder, workflow, e2eText] = await Promise.all([
  fs.readFile(RUNNER_PATH, 'utf8'),
  fs.readFile(BUILDER_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(E2E_PATH, 'utf8'),
]);
const e2e = JSON.parse(e2eText);

const syntax = spawnSync(process.execPath, ['--check', RUNNER_PATH], { cwd: ROOT, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr || 'Migration 1043 readback certifier syntax check failed.');

const selfTest = spawnSync(process.execPath, [RUNNER_PATH, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(selfTest.status, 0, selfTest.stderr || 'Migration 1043 readback certifier self-test failed.');
const selfTestPayload = JSON.parse(selfTest.stdout);
assert.equal(selfTestPayload.ok, true);
assert.equal(selfTestPayload.terminal_outcome, 'migration_1043_readback_only_contract_verified');
assert.equal(selfTestPayload.canonical_schema_table_field, 'TABLE_NAME');
assert.equal(selfTestPayload.legacy_shape_accepted, false);
assert.equal(selfTestPayload.apply_capability_present, false);

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.ok(workflow.includes(`github.event.comment.body == '${CERTIFY_CONFIRM}'`));
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /sprint69-1043-readback-certify\.mjs/);

for (const text of [runner, workflow]) {
  assert.doesNotMatch(text, /APPLY_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE/);
  assert.doesNotMatch(text, /name:\s*['"]governed_migration_execute['"]/);
  assert.doesNotMatch(text, /capability_resolution_envelope_(?:create|approve|apply_authorize)/);
}
assert.doesNotMatch(workflow, /mode:\s*['"]apply['"]/);

const governedToolCalls = [...runner.matchAll(/requestRaw\('\/gpt\/tools\/call',\s*\{([\s\S]*?)\n\s*\}\);/g)]
  .map((match) => match[1]);
assert.equal(governedToolCalls.length, 1, 'Readback certifier must expose exactly one governed tool call.');
assert.match(governedToolCalls[0], /name:\s*['"]governed_migration_schema_readback['"]/);
assert.doesNotMatch(governedToolCalls[0], /mode:\s*['"]apply['"]/);

assert.match(runner, /name: 'governed_migration_schema_readback'/);
assert.match(runner, /readback\?\.schema\?\.tables/);
assert.match(runner, /readback\?\.expectations\?\.missing\?\.tables/);
assert.match(runner, /row\?\.TABLE_NAME/);
assert.doesNotMatch(runner, /readback\?\.tables/);
assert.match(runner, /String\(ledger\?\.mode \|\| ''\)\.toLowerCase\(\) === 'apply'/);
assert.match(runner, /import \{ buildAdminControlDbReadRequest \} from '\.\/lib\/admin-control-db-request\.mjs';/);
assert.match(runner, /buildAdminControlDbReadRequest\(\{[\s\S]*?sql,[\s\S]*?params,[\s\S]*?maxRows: 20,[\s\S]*?authorityContext:/);
assert.doesNotMatch(runner, /tool:\s*['"]db['"]/);
assert.doesNotMatch(runner, /action:\s*['"]run['"]/);
assert.match(builder, /\[contract\.request\.sql_field\]: sql/);
assert.match(builder, /read_only: true/);
assert.match(builder, /max_rows: maxRows/);
assert.match(runner, /v_managed_execution_lifecycle_readiness/);
assert.match(runner, /apply_sent: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /managed_control_plane_write_executed: false/);

assert.equal(e2e.feature_key, 'sprint69-1043-readback-certification');
assert.equal(e2e.current_phase, 'mvp');
const include = new Set(e2e.scope?.include || []);
for (const expectedPath of [
  '.changes/e2e/sprint69-1043-readback-certification.json',
  '.github/ops/sprint69-1043-apply.mjs',
  '.github/ops/sprint69-1043-readback-certify.mjs',
  '.github/workflows/sprint69-1043-readback-certify.yml',
  'http-generic-api/test-sprint69-1043-apply-contract.mjs',
  'http-generic-api/test-sprint69-1043-readback-certification-contract.mjs',
]) assert.ok(include.has(expectedPath), `E2E scope is missing ${expectedPath}`);

console.log(JSON.stringify({
  ok: true,
  contract: 'sprint69_1043_readback_certification_contract_test.v1',
  exact_trigger: CERTIFY_CONFIRM,
  issue: 4449,
  readback_only: true,
  canonical_schema_shape: 'schema.tables[].TABLE_NAME',
  canonical_admin_db_builder: true,
  historical_apply_ledger_is_read_only_evidence: true,
  apply_capability_present: false,
  secrets_included: false,
}, null, 2));
