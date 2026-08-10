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

assert.match(runner, /buildAdminControlDbReadRequest/);
assert.match(runner, /function dbReadInvocation/);
assert.match(runner, /assert\.match\(sql\.trim\(\), \/\^SELECT\\b\/i/);
assert.match(runner, /assert\.doesNotMatch\(sql, \/\\b\(\?:INSERT\|UPDATE\|DELETE\|REPLACE\|ALTER\|DROP\|TRUNCATE\|CREATE\|GRANT\|REVOKE\)\\b\/i/);
assert.match(runner, /read_only/);
const reconciliationBody = runner.slice(runner.indexOf('async function reconcileEnvelopeCreateFailure()'), runner.indexOf('function envelopeBindingSha'));
assert.match(reconciliationBody, /SELECT envelope_id/);
assert.match(reconciliationBody, /WHERE requested_by = \?/);
assert.match(reconciliationBody, /\[REQUESTED_BY\]/);
assert.doesNotMatch(reconciliationBody, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);

assert.match(runner, /GITHUB_RUN_ID/);
assert.match(runner, /GITHUB_RUN_ATTEMPT/);
assert.match(runner, /github_actions_tenant_request_identity_collation_dry_run:\$\{GITHUB_RUN_ID\}:\$\{GITHUB_RUN_ATTEMPT\}/);
assert.match(runner, /`--requested-by=\$\{REQUESTED_BY\}`/);

assert.match(runner, /let managedControlPlaneWriteOutcome = 'not_attempted';/);
assert.match(runner, /managedControlPlaneWriteOutcome = 'attempted_unknown';/);
assert.match(runner, /managedControlPlaneWriteOutcome = 'confirmed';/);
assert.match(runner, /function managedControlPlaneWriteExecuted\(\)/);
assert.match(runner, /return null;/);
const envelopeBody = runner.slice(runner.indexOf('async function createReadyAuthorizationEnvelope()'), runner.indexOf('async function bootstrapAuthorization()'));
const attemptIndex = envelopeBody.indexOf("managedControlPlaneWriteOutcome = 'attempted_unknown'");
const requestIndex = envelopeBody.indexOf("shellInvocation('capability_resolution_envelope_create'");
const confirmedIndex = envelopeBody.indexOf("managedControlPlaneWriteOutcome = 'confirmed'");
assert(attemptIndex >= 0 && requestIndex > attemptIndex, 'Envelope write must enter attempted_unknown before the create request');
assert(confirmedIndex > requestIndex, 'Envelope write can only become confirmed after a successful create response');

assert.match(runner, /function commandEvidence\(result\)/);
for (const field of ['http_status', 'transport_error', 'stdout', 'stderr', 'payload']) {
  assert.ok(runner.includes(field), `Failure provenance must retain ${field}`);
}
assert.match(runner, /sanitizeText/);
assert.match(runner, /authorization-envelope-create-failure\.json/);
assert.match(runner, /matching_row_persisted_response_failed/);
assert.match(runner, /no_matching_row_after_failure/);
assert.match(runner, /reconciliation_unavailable/);
assert.match(runner, /error_provenance: error\?\.provenance \|\| null/);

const failureCatch = runner.slice(runner.indexOf("await writeJson('authorization-envelope-create-failure.json'"), runner.indexOf("managedControlPlaneWriteOutcome = 'confirmed'"));
assert.doesNotMatch(failureCatch, /capability_resolution_envelope_approve|governed_migration_authorization_bootstrap|governed_migration_execute/);

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
  failure_provenance_preserved: true,
  envelope_create_write_outcome_tri_state: true,
  envelope_create_failure_reconciliation_read_only: true,
  dry_run_only: true,
  apply_available: false,
  source_merge_sha: SOURCE_MERGE_SHA,
  provider_call_executed: false,
  external_business_write_executed: false,
  secrets_included: false,
}, null, 2));
