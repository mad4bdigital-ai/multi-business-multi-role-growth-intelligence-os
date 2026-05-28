import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/161_sprint65_credential_tenant_promotion_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

assert(routeFile.includes('/credentials/bindings/promote'), 'tenant credential promotion route must exist');
assert(routeFile.includes('promotedOwnerType !== "tenant"'), 'promotion v1 must be tenant-only');
assert(routeFile.includes('active user_app_connection'), 'promotion must require active connection');
assert(routeFile.includes('promotion_approved'), 'promotion must require explicit approval');
assert(routeFile.includes('promotion_reason'), 'promotion must require promotion reason');
assert(routeFile.includes('promotion_approval_required'), 'promotion must reject missing approval metadata');
assert(routeFile.includes('promotion_source_not_resolved'), 'promotion must preflight source credential resolution');
assert(routeFile.includes('buildCredentialResolutionPlan'), 'promotion must use resolution plan preflight/readback');
assert(routeFile.includes('credential_ref'), 'promotion must create a credential_ref pointer');
assert(routeFile.includes('user_app_connection:${connection.connection_id}:encrypted_credentials'), 'promotion must point to user_app_connection encrypted credentials');
assert(routeFile.includes('owner_type, owner_id, user_id, system_id, installation_id, connection_id'), 'promotion insert must control ownership columns');
assert(routeFile.includes("'tenant'"), 'promotion must insert tenant owner type');
assert(routeFile.includes('secret_copied: false'), 'promotion must not copy secret values');
assert(routeFile.includes('token_returned: false'), 'promotion must not return tokens');
assert(routeFile.includes('platform_wide_promotion_enabled: false'), 'platform-wide promotion must remain disabled');
assert(routeFile.includes('secrets_included: false'), 'promotion must return secrets_included=false');
assert(!routeFile.includes('includeSecret: true'), 'promotion must not request decrypted secrets');
assert(!routeFile.includes('decryptToken('), 'promotion route must not decrypt tokens');

assert(migration.includes('credential_binding_promote_tenant'), 'tenant promotion tool must be registered');
assert(migration.includes('/credentials/bindings/promote'), 'tenant promotion tool path must be registered');
assert(migration.includes('read_write'), 'tenant promotion tool must be read_write');
assert(migration.includes('no_secrets'), 'tenant promotion tool must be tagged no_secrets');
assert(migration.includes('no_secret_copy'), 'tenant promotion tool must be tagged no_secret_copy');

assert(openapi.includes('/credentials/bindings/promote:'), 'tenant promotion path must be documented');
assert(openapi.includes('CredentialBindingPromoteTenantRequest'), 'tenant promotion request schema must be documented');
assert(openapi.includes('CredentialBindingPromoteTenantResponse'), 'tenant promotion response schema must be documented');
assert(openapi.includes('operationId: credentialBindingPromoteTenant'), 'tenant promotion operationId must exist');
assert(openapi.includes('secret_copied: { type: boolean, enum: [false] }'), 'OpenAPI must document no secret copy');
assert(openapi.includes('platform_wide_promotion_enabled: { type: boolean, enum: [false] }'), 'OpenAPI must document platform-wide promotion disabled');

console.log('credential tenant promotion tests passed');
