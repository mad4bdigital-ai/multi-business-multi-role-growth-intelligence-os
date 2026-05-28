import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolver = readFileSync('cmsAccountClaimResolver.js', 'utf8');
const connectApi = readFileSync('routes/connectApiRoutes.js', 'utf8');
const migration = readFileSync('migrations/058_create_cms_account_claims.sql', 'utf8');

assert(resolver.includes('connected_at, last_used_at'), 'CMS claim resolver must insert live user_app_connections timestamp columns');
assert(resolver.includes("'basic_auth'"), 'CMS claim resolver must use supported user_app_connections auth_type enum');
assert(resolver.includes('last_used_at = NOW()'), 'CMS claim resolver must update last_used_at on upsert');
assert(!resolver.includes('created_at, updated_at'), 'CMS claim resolver must not rely on missing user_app_connections created_at/updated_at columns');
assert(resolver.includes('application_password: applicationPassword'), 'CMS claim resolver must preserve encrypted application password payload');
assert(!resolver.includes('console.log(applicationPassword'), 'CMS claim resolver must not log application password');

assert(migration.includes('CREATE TABLE IF NOT EXISTS cms_account_claims'), 'CMS account claims table migration must exist');
assert(migration.includes('approval_required'), 'CMS claim migration must include approval_required');
assert(migration.includes('approved_by'), 'CMS claim migration must include approval audit fields');

assert(connectApi.includes('/connect/api/cms/claims/:claim_id/approve'), 'CMS claim approval route must exist');
assert(connectApi.includes('credential_bindings'), 'CMS claim approval must create/read credential binding');
assert(connectApi.includes("owner_type = 'tenant'"), 'CMS claim approval must promote to tenant-owned binding only');
assert(connectApi.includes('wordpress_app_password'), 'CMS claim approval promotion must use WordPress app-password role');
assert(connectApi.includes('user_app_connection:${claim.connection_id}:encrypted_credentials.application_password'), 'CMS claim approval must promote a pointer to the existing encrypted connection credential');
assert(connectApi.includes('secret_copied: false'), 'CMS claim approval must not copy secrets');
assert(connectApi.includes('token_returned: false'), 'CMS claim approval must not return tokens');
assert(connectApi.includes('secrets_included: false'), 'CMS claim approval must not return secrets');
assert(!connectApi.includes('decryptToken('), 'CMS claim approval must not decrypt tokens');
assert(!connectApi.includes('application_password:'), 'CMS claim approval route must not accept or return application_password');

console.log('cms claim approval promotion tests passed');
