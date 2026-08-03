import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const RUNNER_PATH = path.join(ROOT, '.github/ops/sprint69-1043-apply.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/sprint69-1043-apply.yml');
const E2E_PATH = path.join(ROOT, '.changes/e2e/sprint69-1043-apply-contract.json');

const APPLY_CONFIRM = 'APPLY_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const READINESS_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const CHECKSUM = 'a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9';
const BLOB = '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c';
const SOURCE_MERGE = 'a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3';
const REPOSITORY_READINESS = '0cd5e8c894f2877db9de1e1942ff9db25d9ecc5e';
const RUNTIME_READINESS_CONTRACT = 'f576d269d7af8d8deb52add9994a0cc70e05df0b';
const RECOVERY_MERGE = '22569cf75d22ca708ca7f12ea271828b3c642333';
const PROJECTION_MERGE = '5a612237cb472308e243df03f95f05ea611680e7';

const [runner, workflow, e2eText] = await Promise.all([
  fs.readFile(RUNNER_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(E2E_PATH, 'utf8'),
]);
const e2e = JSON.parse(e2eText);

const syntax = spawnSync(process.execPath, ['--check', RUNNER_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Migration 1043 Apply runner syntax check failed.');

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${APPLY_CONFIRM}'`));
assert.equal(workflow.includes(READINESS_CONFIRM), false, 'Apply workflow must not reuse the readiness trigger.');
assert.match(workflow, /^\s{2}apply:/m);
assert.equal((workflow.match(/^\s{2}apply:/gm) || []).length, 1);
assert.doesNotMatch(workflow, /gh\s+api|issues:\s*write|comments\/|workflow_dispatch/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

for (const value of [
  APPLY_CONFIRM,
  CHECKSUM,
  BLOB,
  SOURCE_MERGE,
  REPOSITORY_READINESS,
  RUNTIME_READINESS_CONTRACT,
  RECOVERY_MERGE,
  PROJECTION_MERGE,
]) {
  assert.ok(runner.includes(value), `Apply runner is missing pinned value ${value}.`);
}

assert.match(runner, /governed_migration_authorization_registry/);
assert.match(runner, /authorization_source, AUTHORIZATION_SOURCE/);
assert.match(runner, /policy_key, AUTHORIZATION_POLICY_KEY/);
assert.match(runner, /allow_apply \|\| 0\), 1/);
assert.match(runner, /metadata\.migration_checksum_sha256/);
assert.match(runner, /metadata\.expected_statement_count/);
assert.match(runner, /metadata\.pull_request/);
assert.match(runner, /metadata\.merge_sha/);
assert.doesNotMatch(runner, /governed_migration_authorization_bootstrap/);

assert.match(runner, /name: 'governed_migration_schema_readback'/);
assert.match(runner, /name: 'governed_migration_execute'/);
assert.match(runner, /mode: 'dry_run'/);
assert.equal((runner.match(/mode: 'apply'/g) || []).length, 1, 'Apply runner must expose exactly one Apply request.');
assert.match(runner, /confirm: APPLY_CONFIRM/);
assert.match(runner, /capability_resolution_envelope_apply_authorize/);
assert.match(runner, /apply_sent: applySent/);
assert.match(runner, /apply_retried: false/);
assert.match(runner, /retry_permitted: false/);
assert.match(runner, /no retry is permitted before exact readback/i);
assert.doesNotMatch(runner, /activation_authorized_surface_registry_sync/);
assert.match(runner, /activation_registry_sync_executed: false/);
assert.match(runner, /provider_call_executed: false/);
assert.match(runner, /credential_payload_accessed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /secrets_included: false/);

assert.match(runner, /v_managed_execution_lifecycle_readiness/);
assert.match(runner, /present_table_count/);
assert.match(runner, /present_binding_column_count/);
assert.match(runner, /readiness_status/);
assert.match(runner, /exactApplyLedger/);
assert.match(runner, /exactObjects/);
assert.match(runner, /final_readback/);

const mainBody = runner.slice(runner.indexOf('async function main()'));
const order = [
  "stage = 'repository_and_runtime_parity'",
  "stage = 'readback_first'",
  "stage = 'readiness_authorization_readback'",
  "stage = 'same_cycle_dry_run'",
  "stage = 'execution_envelope'",
  "stage = 'single_apply_attempt'",
  "stage = 'final_readback'",
  "stage = 'apply_complete'",
].map((marker) => ({ marker, index: mainBody.indexOf(marker) }));
for (const item of order) assert(item.index >= 0, `Apply runner main flow is missing ${item.marker}.`);
for (let index = 1; index < order.length; index += 1) {
  assert(order[index - 1].index < order[index].index, `${order[index - 1].marker} must precede ${order[index].marker}.`);
}

assert.equal(e2e.feature_key, 'sprint69-1043-apply-contract');
assert.equal(e2e.current_phase, 'mvp');
const include = new Set(e2e.scope?.include || []);
for (const expectedPath of [
  '.github/ops/sprint69-1043-apply.mjs',
  '.github/workflows/sprint69-1043-apply.yml',
  '.changes/e2e/sprint69-1043-apply-contract.json',
  'http-generic-api/test-sprint69-1043-apply-contract.mjs',
]) {
  assert.ok(include.has(expectedPath), `E2E contract is missing ${expectedPath}.`);
}
const journey = e2e.phases?.find((phase) => phase.id === 'mvp')?.e2e_journeys?.[0];
assert.ok(journey?.end_to_end === true);
assert.ok((journey.tests || []).some((test) => test.path === 'test-sprint69-1043-apply-contract.mjs'));
assert.ok((journey.assertions || []).some((value) => String(value).includes('never creates readiness authorization')));
assert.ok((journey.assertions || []).some((value) => String(value).includes('never retries Apply')));

console.log(JSON.stringify({
  ok: true,
  contract: 'sprint69_1043_apply_contract_test.v1',
  exact_trigger: APPLY_CONFIRM,
  issue: 4449,
  readiness_authorization_must_preexist: true,
  same_cycle_dry_run_required: true,
  apply_request_count: 1,
  apply_retry_allowed: false,
  exact_ledger_and_readiness_required: true,
  activation_registry_sync_included: false,
  provider_call_executed: false,
  external_business_write_executed: false,
  secrets_included: false,
}, null, 2));
