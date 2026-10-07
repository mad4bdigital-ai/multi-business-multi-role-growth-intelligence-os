import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const routeFile = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/160_sprint65_credential_resolution_plan_tool.sql', 'utf8');
const bindingPolicyMigration = readFileSync('migrations/20261007_credential_platform_binding_policy.sql', 'utf8');
const stagingRoleManifest = JSON.parse(readFileSync('config/staging-database-role-migration-manifest.json', 'utf8'));
const openapi = YAML.parse(readFileSync('openapi.yaml', 'utf8'));

assert(routeFile.includes('/credentials/effective/plan'), 'credential resolution plan route must exist');
assert(routeFile.includes('buildCredentialResolutionPlan'), 'credential resolution plan helper must exist');
assert(routeFile.includes('credential_bindings'), 'plan must inspect credential bindings');
assert(routeFile.includes('source: "credential_bindings"'), 'credential binding candidates must be labeled as credential_bindings');
assert(routeFile.includes('user_app_connections_fallback'), 'plan must include user app connection fallback');
assert(routeFile.includes('actions.secret_store_ref'), 'plan must include action secret fallback');
assert(routeFile.includes('target_tenant_secret_convention'), 'plan must include target tenant secret convention');
assert(routeFile.includes('tenant_integration_policies'), 'plan must include tenant integration policies');
assert(routeFile.includes('allow_platform_binding'), 'plan must separate platform binding permission from fallback permission');
assert(routeFile.includes('platform_binding_allowed_by_request'), 'plan response must expose explicit platform-binding policy');
assert(routeFile.includes('getEffectiveCredentialStatus'), 'plan must include effective safe status');
assert(routeFile.includes('credential_values_returned: false'), 'plan must not return credential values');
assert(routeFile.includes('candidateEligibility'), 'plan must annotate candidate eligibility');
assert(routeFile.includes('eligible_for_request'), 'plan candidates must include eligibility flag');
assert(routeFile.includes('ineligibility_reasons'), 'plan candidates must include ineligibility reasons');
assert(routeFile.includes('private_connection_user_context_required'), 'plan must explain private connection user-context requirements');
assert(routeFile.includes('user_owner_context_required'), 'plan must reject user-owned bindings without user context');
assert(routeFile.includes('user_owner_context_mismatch'), 'plan must reject user-owned bindings for another user');
assert(routeFile.includes('connection_owner_context_mismatch'), 'plan must reject connection-owned bindings for another connection');
assert(routeFile.includes('tenant_owner_context_mismatch'), 'plan must reject tenant-owned bindings for another tenant');
assert(routeFile.includes('credential_connection_user_scope_mismatch'), 'plan must reject a connection owned by another user');
assert(routeFile.includes('secret_values_returned: false'), 'plan must not return secret values');
assert(routeFile.includes('secrets_included: false'), 'plan must return secrets_included=false');
assert(!routeFile.includes('includeSecret: true'), 'plan must not request secret inclusion');

assert(migration.includes('credential_effective_plan'), 'credential plan admin tool must be registered');
assert(migration.includes('/credentials/effective/plan'), 'credential plan tool path must be registered');
assert(migration.includes('read_only'), 'credential plan tool must be read_only');
assert(migration.includes('no_secrets'), 'credential plan tool must be tagged no_secrets');
assert(migration.includes('no_token_returned'), 'credential plan tool must be tagged no_token_returned');
assert(bindingPolicyMigration.includes('allow_platform_binding'), 'forward migration must expose allow_platform_binding');
assert(
  stagingRoleManifest.canonical_seed_lifecycle?.seed_files?.includes('20261007_credential_platform_binding_policy.sql'),
  'credential platform-binding policy migration must remain registered as a canonical Staging replay seed',
);
assert.match(
  bindingPolicyMigration,
  /INSERT\s+INTO\s+`?admin_platform_endpoint_tools`?[\s\S]*['"]credential_effective_plan['"][\s\S]*ON\s+DUPLICATE\s+KEY\s+UPDATE/i,
  'forward migration must remain a canonical idempotent UPSERT scoped to credential_effective_plan',
);

const operation = openapi?.paths?.['/credentials/effective/plan']?.post;
const schemas = openapi?.components?.schemas || {};
const requestSchema = schemas.CredentialEffectivePlanRequest;
const responseSchema = schemas.CredentialEffectivePlanResponse;
const candidateSchema = schemas.CredentialResolutionCandidate;

assert(operation, 'credential plan path must be documented');
assert.equal(operation.operationId, 'credentialEffectivePlan', 'credential plan operationId must be documented');
assert.equal(
  operation.requestBody?.content?.['application/json']?.schema?.$ref,
  '#/components/schemas/CredentialEffectivePlanRequest',
  'credential plan request schema must be documented',
);
assert.equal(
  operation.responses?.['200']?.content?.['application/json']?.schema?.$ref,
  '#/components/schemas/CredentialEffectivePlanResponse',
  'credential plan response schema must be documented',
);
assert(requestSchema, 'CredentialEffectivePlanRequest schema must exist');
assert(responseSchema, 'CredentialEffectivePlanResponse schema must exist');
assert(candidateSchema, 'CredentialResolutionCandidate schema must exist');
assert.equal(requestSchema.properties?.allow_platform_binding?.type, 'boolean', 'OpenAPI must expose allow_platform_binding');
assert.equal(requestSchema.properties?.allow_platform_binding?.default, true, 'platform binding compatibility default must remain true');
assert.equal(responseSchema.properties?.policy?.properties?.platform_binding_allowed_by_request?.type, 'boolean', 'OpenAPI response must expose binding policy');
assert.deepEqual(
  responseSchema.properties?.policy?.properties?.secret_values_returned?.enum,
  [false],
  'OpenAPI must document no secret values returned',
);
assert.deepEqual(
  responseSchema.properties?.policy?.properties?.credential_values_returned?.enum,
  [false],
  'OpenAPI must document no credential values returned',
);
assert.deepEqual(
  responseSchema.properties?.secrets_included?.enum,
  [false],
  'OpenAPI must document secrets_included=false',
);

console.log('credential resolution plan tests passed');
