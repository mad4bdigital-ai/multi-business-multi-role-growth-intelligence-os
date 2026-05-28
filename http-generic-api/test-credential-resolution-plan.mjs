import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/160_sprint65_credential_resolution_plan_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

assert(routeFile.includes('/credentials/effective/plan'), 'credential resolution plan route must exist');
assert(routeFile.includes('buildCredentialResolutionPlan'), 'credential resolution plan helper must exist');
assert(routeFile.includes('credential_bindings'), 'plan must inspect credential bindings');
assert(routeFile.includes('source: "credential_bindings"'), 'credential binding candidates must be labeled as credential_bindings');
assert(routeFile.includes('user_app_connections_fallback'), 'plan must include user app connection fallback');
assert(routeFile.includes('actions.secret_store_ref'), 'plan must include action secret fallback');
assert(routeFile.includes('target_tenant_secret_convention'), 'plan must include target tenant secret convention');
assert(routeFile.includes('tenant_integration_policies'), 'plan must include tenant integration policies');
assert(routeFile.includes('getEffectiveCredentialStatus'), 'plan must include effective safe status');
assert(routeFile.includes('credential_values_returned: false'), 'plan must not return credential values');
assert(routeFile.includes('candidateEligibility'), 'plan must annotate candidate eligibility');
assert(routeFile.includes('eligible_for_request'), 'plan candidates must include eligibility flag');
assert(routeFile.includes('ineligibility_reasons'), 'plan candidates must include ineligibility reasons');
assert(routeFile.includes('private_connection_user_context_required'), 'plan must explain private connection user-context requirements');
assert(routeFile.includes('secret_values_returned: false'), 'plan must not return secret values');
assert(routeFile.includes('secrets_included: false'), 'plan must return secrets_included=false');
assert(!routeFile.includes('includeSecret: true'), 'plan must not request secret inclusion');

assert(migration.includes('credential_effective_plan'), 'credential plan admin tool must be registered');
assert(migration.includes('/credentials/effective/plan'), 'credential plan tool path must be registered');
assert(migration.includes('read_only'), 'credential plan tool must be read_only');
assert(migration.includes('no_secrets'), 'credential plan tool must be tagged no_secrets');
assert(migration.includes('no_token_returned'), 'credential plan tool must be tagged no_token_returned');

assert(openapi.includes('/credentials/effective/plan:'), 'credential plan path must be documented');
assert(openapi.includes('CredentialEffectivePlanRequest'), 'credential plan request schema must be documented');
assert(openapi.includes('CredentialEffectivePlanResponse'), 'credential plan response schema must be documented');
assert(openapi.includes('CredentialResolutionCandidate'), 'credential resolution candidate schema must be documented');
assert(openapi.includes('operationId: credentialEffectivePlan'), 'credential plan operationId must be documented');
assert(openapi.includes('secret_values_returned: { type: boolean, enum: [false] }'), 'OpenAPI must document no secret values returned');

console.log('credential resolution plan tests passed');
