import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('../.github/workflows/tenant-request-identity-collation-readonly-diagnostic.yml', 'utf8');
const runner = readFileSync('../.github/ops/tenant-request-identity-collation-readonly-diagnostic.mjs', 'utf8');

const TRIGGER = 'RUN_READ_ONLY_DIAGNOSTIC_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';
const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):/m);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${TRIGGER}'`));
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /Checkout trusted default branch/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /Upload sanitized read-only diagnostic evidence/);

for (const value of [TRIGGER, MIGRATION]) {
  assert.ok(runner.includes(value), `Read-only diagnostic runner is missing pinned value ${value}`);
}
assert.ok(
  runner.includes('const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;'),
  `Read-only diagnostic runner must derive pinned resource URI ${RESOURCE_URI} from MIGRATION`
);

assert.match(runner, /shellInvocation\('capability_resolution_dry_run'/);
assert.equal((runner.match(/shellInvocation\('capability_resolution_dry_run'/g) || []).length, 1, 'Diagnostic must invoke exactly one read-only resolver shell alias');
assert.doesNotMatch(runner, /shellInvocation\('capability_resolution_envelope_create'/);
assert.doesNotMatch(runner, /shellInvocation\('capability_resolution_envelope_approve'/);
assert.doesNotMatch(runner, /name:\s*['"]governed_migration_authorization_bootstrap['"]/);
assert.doesNotMatch(runner, /name:\s*['"]governed_migration_execute['"]/);
assert.doesNotMatch(runner, /mode:\s*['"](?:dry_run|apply)['"]/);
assert.doesNotMatch(runner, /APPLY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT/);
assert.doesNotMatch(runner, /AUTHORIZE_GOVERNED_MIGRATION_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT/);

assert.match(runner, /import \{ buildAdminControlDbReadRequest \} from '\.\/lib\/admin-control-db-request\.mjs';/);
assert.match(runner, /return buildAdminControlDbReadRequest\(\{/);
assert.doesNotMatch(runner, /tool:\s*['"]db['"]/);
assert.match(runner, /resource_type:\s*['"]database_query['"]/);
assert.match(runner, /operation_mode:\s*['"]read_only['"]/);
assert.match(runner, /tenant_request_identity_collation_readonly_diagnostic\/\$\{resourceSuffix\}/);
assert.match(runner, /assert\.match\(sql\.trim\(\), \/\^SELECT\\b\/i/);
assert.match(runner, /Diagnostic DB query contains a mutating keyword/);
assert.equal((runner.match(/dbReadInvocation\(/g) || []).length, 5, 'Expected one helper definition and four fixed SELECT readbacks');
assert.match(runner, /information_schema\.COLUMNS/);
assert.match(runner, /admin_platform_endpoint_tools/);
assert.match(runner, /platform_runtime_config/);
assert.match(runner, /capability_resolution_envelope_ledger/);

for (const marker of [
  'mutation_requested: false',
  'envelope_write_attempted: false',
  'authorization_bootstrap_attempted: false',
  'governed_migration_execute_attempted: false',
  'migration_sql_executed: false',
  'apply_authorized: false',
  'apply_sent: false',
  'provider_call_executed: false',
  'credential_payload_accessed: false',
  'external_business_write_executed: false',
  'secrets_included: false',
]) {
  assert.ok(runner.includes(marker), `Read-only diagnostic evidence is missing ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  contract: 'tenant_request_identity_collation_readonly_diagnostic_contract.v1',
  issue: 4449,
  trigger: TRIGGER,
  trusted_main_only: true,
  resolver_alias: 'capability_resolution_dry_run',
  fixed_select_readbacks: 4,
  governed_db_read_builder: true,
  envelope_write_available: false,
  migration_execution_available: false,
  apply_available: false,
  secrets_included: false,
}, null, 2));
