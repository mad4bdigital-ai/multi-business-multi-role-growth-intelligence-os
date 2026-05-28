import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/161_sprint65_credential_binding_promotion_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

assert(routeFile.includes('/credentials/bindings/promote'), 'credential binding promotion route must exist');
assert(routeFile.includes('promoteCredentialBinding'), 'credential promotion service helper must exist');
assert(routeFile.includes('promotion_approved'), 'promotion must require explicit approval');
assert(routeFile.includes('promotion_reason'), 'promotion must require a reason');
assert(routeFile.includes('credential_promotion_source_not_resolved'), 'promotion must preflight source credential resolution');
assert(routeFile.includes('buildCredentialResolutionPlan'), 'promotion must use credential resolution plan as preflight/readback');
assert(routeFile.includes('secret_copied: false'), 'promotion must not copy secrets');
assert(routeFile.includes('secret_value_returned: false'), 'promotion must not return secret values');
assert(routeFile.includes('token_returned: false'), 'promotion must not return tokens');
assert(routeFile.includes('secrets_included: false'), 'promotion must return secrets_included=false');
assert(!routeFile.includes('includeSecret: true'), 'promotion must not request secret inclusion');

assert(migration.includes('credential_binding_promote'), 'promotion tool must be registered');
assert(migration.includes('/credentials/bindings/promote'), 'promotion tool path must be registered');
assert(migration.includes('requires_approval'), 'promotion tool must be tagged requires_approval');
assert(migration.includes('no_secret_copy'), 'promotion tool must be tagged no_secret_copy');
assert(migration.includes('no_secrets'), 'promotion tool must be tagged no_secrets');
assert(migration.includes('no_token_returned'), 'promotion tool must be tagged no_token_returned');

assert(openapi.includes('/credentials/bindings/promote:'), 'promotion route must be documented in OpenAPI');
assert(openapi.includes('CredentialBindingPromoteRequest'), 'promotion request schema must be documented');
assert(openapi.includes('CredentialBindingPromoteResponse'), 'promotion response schema must be documented');
assert(openapi.includes('operationId: credentialBindingPromote'), 'promotion operationId must be documented');
assert(openapi.includes('x-openai-isConsequential: true'), 'promotion must be marked consequential');
assert(openapi.includes('secret_copied: { type: boolean, enum: [false] }'), 'OpenAPI must document no secret copy');
assert(openapi.includes('secret_value_returned: { type: boolean, enum: [false] }'), 'OpenAPI must document no secret values returned');

console.log('credential binding promotion tests passed');
