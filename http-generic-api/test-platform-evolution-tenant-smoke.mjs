import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/platformEvolutionRoutes.js', 'utf8');
const migration = readFileSync('migrations/158_sprint65_evolution_tenant_jwt_smoke_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');

assert(routeFile.includes('jwt.sign'), 'tenant smoke route must issue a short-lived JWT internally');
assert(routeFile.includes('/platform/evolution/tenant-smoke'), 'tenant smoke admin route must exist');
assert(routeFile.includes('/tenant/evolution/switch-options'), 'tenant smoke must call tenant switch-options route');
assert(routeFile.includes('/tenant/evolution/activation-card'), 'tenant smoke must call tenant activation-card route');
assert(routeFile.includes('/tenant/evolution/thread-map'), 'tenant smoke must call tenant thread-map route');
assert(routeFile.includes('scopeKeyComparisonSql'), 'tenant smoke must use collation-safe scope_key comparison');
assert(routeFile.includes('INTERNAL_RUNTIME_BASE_URL'), 'tenant smoke must support internal runtime base URL override');
assert(routeFile.includes('tenant_smoke_self_call_failed'), 'tenant smoke must return structured self-call failures');
assert(routeFile.includes('token_returned: false'), 'tenant smoke must explicitly not return token');
assert(routeFile.includes('tenant_checkpoint_write_enabled: false'), 'tenant smoke must keep tenant checkpoint write disabled');
assert(routeFile.includes('secrets_included: false'), 'tenant smoke must not include secrets');
assert(!routeFile.includes('access_token:'), 'tenant smoke response must not expose access_token field');

assert(migration.includes('platform_evolution_tenant_smoke'), 'tenant smoke tool must be registered');
assert(migration.includes('no_token_returned'), 'tenant smoke tool must be tagged no_token_returned');
assert(migration.includes('no_secrets'), 'tenant smoke tool must be tagged no_secrets');

assert(openapi.includes('/platform/evolution/tenant-smoke:'), 'tenant smoke path must be documented in OpenAPI');
assert(openapi.includes('PlatformEvolutionTenantSmokeRequest'), 'tenant smoke request schema must be documented');
assert(openapi.includes('PlatformEvolutionTenantSmokeResponse'), 'tenant smoke response schema must be documented');
assert(openapi.includes('token_returned: { type: boolean, enum: [false] }'), 'OpenAPI must document token_returned=false');
assert(openapi.includes('tenant_checkpoint_write_enabled: { type: boolean, enum: [false] }'), 'OpenAPI must document tenant checkpoint write disabled');

console.log('platform evolution tenant JWT smoke tests passed');
