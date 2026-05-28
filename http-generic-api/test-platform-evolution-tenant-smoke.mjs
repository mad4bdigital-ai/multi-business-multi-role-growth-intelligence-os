import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/platformEvolutionRoutes.js', 'utf8');
const migration = readFileSync('migrations/158_sprint65_evolution_tenant_jwt_smoke_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

assert(routeFile.includes('jwt.sign'), 'tenant smoke route must issue a short-lived JWT internally');
assert(routeFile.includes('/platform/evolution/tenant-smoke'), 'tenant smoke admin route must exist');
assert(routeFile.includes('/platform/evolution/cms-claim-smoke'), 'CMS claim smoke admin route must exist');
assert(routeFile.includes('directCmsClaimApprovalSmoke'), 'CMS claim smoke direct helper must exist');
assert(routeFile.includes('cms_account_claims'), 'CMS claim smoke must exercise cms_account_claims');
assert(routeFile.includes('getEffectiveCredentialStatus'), 'CMS claim smoke must verify effective credential readback');
assert(routeFile.includes('/tenant/evolution/switch-options'), 'tenant smoke must call tenant switch-options route');
assert(routeFile.includes('/tenant/evolution/activation-card'), 'tenant smoke must call tenant activation-card route');
assert(routeFile.includes('/tenant/evolution/thread-map'), 'tenant smoke must call tenant thread-map route');
assert(routeFile.includes('scopeKeyComparisonSql'), 'tenant smoke must use collation-safe scope_key comparison');
assert(routeFile.includes('INTERNAL_RUNTIME_BASE_URL'), 'tenant smoke must support internal runtime base URL override');
assert(routeFile.includes('tenant_smoke_self_call_failed'), 'tenant smoke must return structured self-call failures');
assert(routeFile.includes('directTenantSmoke'), 'tenant smoke must support direct scope fallback');
assert(routeFile.includes('transport_mode'), 'tenant smoke must expose transport mode');
assert(routeFile.includes('direct_scope'), 'tenant smoke must default to direct_scope mode');
assert(routeFile.includes('jwt_verified'), 'tenant smoke must verify internally issued JWT in direct mode');
assert(routeFile.includes('createTenantWriteSmokeCheckpoint'), 'tenant smoke must support scoped checkpoint write smoke');
assert(routeFile.includes('include_write'), 'tenant smoke must expose include_write option');
assert(routeFile.includes('checkpoint_write'), 'tenant smoke response must include checkpoint_write check when available');
assert(routeFile.includes('token_returned: false'), 'tenant smoke must explicitly not return token');
assert(routeFile.includes('tenant_checkpoint_write_enabled: false'), 'tenant smoke must keep tenant checkpoint write disabled');
assert(routeFile.includes('secrets_included: false'), 'tenant smoke must not include secrets');
assert(!routeFile.includes('access_token:'), 'tenant smoke response must not expose access_token field');

assert(migration.includes('include_write'), 'tenant smoke tool schema must include include_write');
assert(migration.includes('platform_evolution_tenant_smoke'), 'tenant smoke tool must be registered');
assert(migration.includes('no_token_returned'), 'tenant smoke tool must be tagged no_token_returned');
assert(migration.includes('no_secrets'), 'tenant smoke tool must be tagged no_secrets');

assert(openapi.includes('/platform/evolution/tenant-smoke:'), 'tenant smoke path must be documented in OpenAPI');
assert(openapi.includes('PlatformEvolutionTenantSmokeRequest'), 'tenant smoke request schema must be documented');
assert(openapi.includes('PlatformEvolutionTenantSmokeResponse'), 'tenant smoke response schema must be documented');
assert(openapi.includes('include_write'), 'OpenAPI must document include_write');
assert(openapi.includes('checkpoint_write'), 'OpenAPI must document checkpoint_write check');
assert(openapi.includes('token_returned: { type: boolean, enum: [false] }'), 'OpenAPI must document token_returned=false');
assert(openapi.includes('tenant_checkpoint_write_enabled: { type: boolean, enum: [false] }'), 'OpenAPI must document tenant checkpoint write disabled');

console.log('platform evolution tenant JWT smoke tests passed');
