import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/tenant-request-identity-collation-dry-run.yml', 'utf8');
const runner = readFileSync('../.github/ops/tenant-request-identity-collation-dry-run.mjs', 'utf8');

const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';
const CHECKSUM = 'cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7';
const SOURCE_MERGE_SHA = '894f112c452887e9c8f3f58fe55af598cb04af31';

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):/m);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${AUTH_CONFIRM}'`));
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /Checkout trusted default branch/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

for (const value of [MIGRATION, AUTH_CONFIRM, CHECKSUM, SOURCE_MERGE_SHA]) {
  assert.ok(runner.includes(value), `Dry Run runner is missing pinned value ${value}`);
}

assert.match(runner, /name: 'governed_migration_authorization_bootstrap'/);
assert.match(runner, /capability_resolution_envelope_create/);
assert.match(runner, /capability_resolution_envelope_approve/);
assert.match(runner, /name: 'governed_migration_execute'/);
assert.match(runner, /mode: 'dry_run'/);
assert.equal((runner.match(/mode: 'dry_run'/g) || []).length, 1, 'Dry Run runner must expose exactly one migration execution request');
assert.doesNotMatch(runner, /mode: ['"]apply['"]/);
assert.doesNotMatch(runner, /APPLY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT/);
assert.doesNotMatch(runner, /governed_migration_ledger[^\n]*INSERT|INSERT[^\n]*governed_migration_ledger/i);
assert.match(runner, /assert\.equal\(result\?\.applies_sql, false/);
assert.match(runner, /apply_authorized: false/);
assert.match(runner, /apply_sent: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /provider_call_executed: false/);
assert.match(runner, /credential_payload_accessed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /secrets_included: false/);

assert.match(runner, /let managedControlPlaneWriteExecuted = false;/);
const envelopeBody = runner.slice(runner.indexOf('async function createReadyAuthorizationEnvelope()'), runner.indexOf('async function bootstrapAuthorization()'));
assert.match(envelopeBody, /const createdPayload = await adminShell[\s\S]*managedControlPlaneWriteExecuted = true;/);
assert.match(runner, /managed_control_plane_write_executed: managedControlPlaneWriteExecuted/);
assert.equal((runner.match(/managed_control_plane_write_executed: managedControlPlaneWriteExecuted/g) || []).length, 3, 'State, final state, and summary must all report actual lifecycle writes');
assert.doesNotMatch(runner, /managed_control_plane_write_executed: authorizationCreated/);

const mainBody = runner.slice(runner.indexOf('async function main()'));
const stages = [
  "stage = 'repository_and_runtime_parity'",
  "stage = 'authorization_envelope'",
  "stage = 'authorization_bootstrap'",
  "stage = 'dry_run'",
  "stage = 'complete'",
].map((marker) => ({ marker, index: mainBody.indexOf(marker) }));
for (const item of stages) assert(item.index >= 0, `Dry Run flow is missing ${item.marker}`);
for (let index = 1; index < stages.length; index += 1) {
  assert(stages[index - 1].index < stages[index].index, `${stages[index - 1].marker} must precede ${stages[index].marker}`);
}

console.log(JSON.stringify({
  ok: true,
  contract: 'tenant_request_identity_collation_dry_run_contract.v1',
  issue: 4449,
  exact_trigger: AUTH_CONFIRM,
  checksum_bound_authorization_bootstrap: true,
  idempotent_rerun_managed_write_reporting: true,
  dry_run_only: true,
  apply_available: false,
  source_merge_sha: SOURCE_MERGE_SHA,
  provider_call_executed: false,
  external_business_write_executed: false,
  secrets_included: false,
}, null, 2));
