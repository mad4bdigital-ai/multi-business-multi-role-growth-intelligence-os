import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/161_sprint65_credential_tenant_promotion_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');
const preciseRegistry = readFileSync('openapi-route-contracts.yaml', 'utf8');
const preciseContract = readFileSync('openapi/credential-binding-promote-tenant.yaml', 'utf8');

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
assert(migration.includes('requires_approval'), 'tenant promotion tool must be tagged requires_approval');
assert(migration.includes('preflight_required'), 'tenant promotion tool must be tagged preflight_required');
assert(migration.includes('promotion_approved'), 'tenant promotion tool schema must require promotion approval');
assert(migration.includes('promotion_reason'), 'tenant promotion tool schema must require promotion reason');

assert(openapi.includes('/credentials/bindings/promote:'), 'tenant promotion path must be composed in the root OpenAPI document');
assert(
  openapi.includes('$ref: ./openapi/credential-binding-promote-tenant.yaml#/credentialBindingPromoteTenant'),
  'tenant promotion root path must resolve through the canonical precise contract',
);

assert(preciseRegistry.includes('POST /admin/credentials/bindings/promote:'), 'tenant promotion must be registered as a precise route contract');
assert(preciseRegistry.includes("path_item_ref: './openapi/credential-binding-promote-tenant.yaml#/credentialBindingPromoteTenant'"), 'tenant promotion registry entry must bind the canonical path item');
assert(preciseRegistry.includes('replace_inline_operation_ids:'), 'tenant promotion registry entry must declare its guarded legacy-inline migration');
assert(preciseRegistry.includes('- credentialBindingPromoteTenant'), 'guarded migration must require the exact legacy operationId');

assert(preciseContract.includes('CredentialBindingPromoteTenantRequest'), 'tenant promotion request schema must be documented in the canonical fragment');
assert(preciseContract.includes('CredentialBindingPromoteTenantResponse'), 'tenant promotion response schema must be documented in the canonical fragment');
assert(preciseContract.includes('operationId: credentialBindingPromoteTenant'), 'tenant promotion operationId must remain stable');
assert(preciseContract.includes('promotion_source_not_resolved'), 'canonical contract must document the failed source-resolution preflight');
assert(preciseContract.includes('name: Idempotency-Key'), 'canonical contract must document the accepted idempotency header');
assert(preciseContract.includes('idempotency_key'), 'canonical request contract must retain the required body idempotency key');
assert(preciseContract.includes('promotion_approved:'), 'canonical request and response contracts must document explicit approval');
assert(preciseContract.includes('enum: [true]'), 'canonical contract must constrain approved promotion evidence to true');
assert(preciseContract.includes('promoted_owner_type:'), 'canonical response must document tenant ownership');
assert(preciseContract.includes('enum: [tenant]'), 'canonical response must remain tenant-only');
assert(preciseContract.includes('secret_copied:'), 'canonical response must expose the no-secret-copy evidence field');
assert(preciseContract.includes('token_returned:'), 'canonical response must expose the no-token-return evidence field');
assert(preciseContract.includes('platform_wide_promotion_enabled:'), 'canonical response must expose the platform-wide promotion safety field');
assert(
  (preciseContract.match(/enum: \[false\]/g) || []).length >= 4,
  'canonical contract must constrain secret copy, token return, platform-wide promotion, and secret inclusion to false',
);
assert(preciseContract.includes("'409':"), 'canonical contract must document source-preflight conflict response');

console.log('credential tenant promotion tests passed');
