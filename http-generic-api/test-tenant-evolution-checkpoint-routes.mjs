import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _testingTenantEvolutionRoutes } from './routes/tenantEvolutionRoutes.js';

const routeFile = readFileSync('routes/tenantEvolutionRoutes.js', 'utf8');
const indexFile = readFileSync('routes/index.js', 'utf8');
const migration = readFileSync('migrations/156_sprint65_tenant_evolution_checkpoint_read_tools.sql', 'utf8');

assert(routeFile.includes('export function buildTenantEvolutionRoutes'), 'tenant evolution route builder must be exported');
assert(routeFile.includes('/tenant/evolution/activation-card'), 'tenant activation-card route must exist');
assert(routeFile.includes('/tenant/evolution/thread-map'), 'tenant thread-map route must exist');
assert(routeFile.includes('/tenant/evolution/open-evidence'), 'tenant open-evidence route must exist');
assert(routeFile.includes('requireTenantUserJwt'), 'tenant routes must require user JWT');
assert(routeFile.includes('fetchActiveMembershipForTenant'), 'tenant routes must require active membership');
assert(routeFile.includes('v_platform_evolution_scope_access'), 'tenant routes must check evolution scope access');
assert(routeFile.includes("access_state = 'allowed'"), 'tenant scope resolution must require allowed access');
assert(routeFile.includes('v_platform_evolution_activation_card'), 'tenant activation-card route must read activation card view');
assert(routeFile.includes('v_platform_evolution_thread_map'), 'tenant thread-map route must read thread map view');
assert(routeFile.includes('v_platform_evolution_open_evidence'), 'tenant open-evidence route must read open evidence view');
assert(routeFile.includes('secrets_included: false'), 'tenant routes must not return secrets');
assert(!routeFile.includes('/tenant/evolution/checkpoints'), 'tenant checkpoint write route must not be exposed in read-only sprint');

assert(indexFile.includes('buildTenantEvolutionRoutes'), 'routes index must import/register tenant evolution routes');
assert(indexFile.includes('app.use(buildTenantEvolutionRoutes())'), 'tenant evolution routes must be mounted');

for (const toolKey of [
  'tenant_evolution_activation_card',
  'tenant_evolution_thread_map',
  'tenant_evolution_open_evidence',
]) {
  assert(migration.includes(toolKey), `${toolKey} must be registered as a tenant platform endpoint tool`);
}
assert(migration.includes('tenant_platform_endpoint_tools'), 'migration must target tenant tool registry');
assert(migration.includes('scope_gated'), 'tenant tools must be tagged scope_gated');
assert(migration.includes('no_secrets'), 'tenant tools must be tagged no_secrets');
assert(!migration.includes('tenant_evolution_checkpoint_create'), 'tenant checkpoint create must not be registered yet');

assert.equal(_testingTenantEvolutionRoutes.boundedInt('999', 50, 1, 100), 100);
assert.equal(_testingTenantEvolutionRoutes.boundedInt('0', 50, 1, 100), 1);
assert.equal(_testingTenantEvolutionRoutes.nonEmptyString('  brand  '), 'brand');
assert.equal(_testingTenantEvolutionRoutes.nonEmptyString('  '), null);

console.log('tenant evolution checkpoint route tests passed');
