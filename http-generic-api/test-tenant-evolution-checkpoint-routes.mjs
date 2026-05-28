import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _testingTenantEvolutionRoutes } from './routes/tenantEvolutionRoutes.js';

const routeFile = readFileSync('routes/tenantEvolutionRoutes.js', 'utf8');
const indexFile = readFileSync('routes/index.js', 'utf8');
const migration156 = readFileSync('migrations/156_sprint65_tenant_evolution_checkpoint_read_tools.sql', 'utf8');
const migration159 = readFileSync('migrations/159_sprint65_tenant_evolution_checkpoint_write_policy.sql', 'utf8');
const migrations = `${migration156}\n${migration159}`;

assert(routeFile.includes('export function buildTenantEvolutionRoutes'), 'tenant evolution route builder must be exported');
assert(routeFile.includes('/tenant/evolution/switch-options'), 'tenant switch-options route must exist');
assert(routeFile.includes('/tenant/evolution/checkpoints'), 'tenant checkpoint create route must exist');
assert(routeFile.includes('/tenant/evolution/activation-card'), 'tenant activation-card route must exist');
assert(routeFile.includes('/tenant/evolution/thread-map'), 'tenant thread-map route must exist');
assert(routeFile.includes('/tenant/evolution/open-evidence'), 'tenant open-evidence route must exist');
assert(routeFile.includes('requireTenantUserJwt'), 'tenant routes must require user JWT');
assert(routeFile.includes('fetchActiveMembershipForTenant'), 'tenant routes must require active membership');
assert(routeFile.includes('v_platform_evolution_scope_access'), 'tenant routes must check evolution scope access');
assert(routeFile.includes("access_state = 'allowed'"), 'tenant scope resolution must require allowed access');
assert(routeFile.includes('hasTenantCheckpointWriteRole'), 'tenant checkpoint create must be role-gated');
assert(routeFile.includes('normalizeTenantCheckpointType'), 'tenant checkpoint type must be restricted');
assert(routeFile.includes('platform_commit_fields_accepted: false'), 'tenant checkpoint create must not accept platform commit authority fields');
assert(routeFile.includes('main_commit_sha'), 'tenant checkpoint insert must explicitly control commit fields');
assert(routeFile.includes('deployed_commit_sha'), 'tenant checkpoint insert must explicitly control deploy fields');
assert(routeFile.includes('v_platform_evolution_activation_card'), 'tenant activation-card route must read activation card view');
assert(routeFile.includes('v_platform_evolution_thread_map'), 'tenant thread-map route must read thread map view');
assert(routeFile.includes('v_platform_evolution_open_evidence'), 'tenant open-evidence route must read open evidence view');
assert(routeFile.includes('secrets_included: false'), 'tenant routes must not return secrets');
assert(!routeFile.includes('access_token:'), 'tenant routes must not expose access_token');

assert(indexFile.includes('buildTenantEvolutionRoutes'), 'routes index must import/register tenant evolution routes');
assert(indexFile.includes('app.use(buildTenantEvolutionRoutes())'), 'tenant evolution routes must be mounted');

for (const toolKey of [
  'tenant_evolution_switch_options',
  'tenant_evolution_checkpoint_create',
  'tenant_evolution_activation_card',
  'tenant_evolution_thread_map',
  'tenant_evolution_open_evidence',
]) {
  assert(migrations.includes(toolKey), `${toolKey} must be registered as a tenant platform endpoint tool`);
}
assert(migrations.includes('tenant_platform_endpoint_tools'), 'migration must target tenant tool registry');
assert(migrations.includes('scope_gated'), 'tenant tools must be tagged scope_gated');
assert(migrations.includes('no_secrets'), 'tenant tools must be tagged no_secrets');
assert(migration159.includes('role_gated'), 'tenant checkpoint create must be tagged role_gated');
assert(migration159.includes('no_platform_commit_authority'), 'tenant checkpoint create must be tagged no_platform_commit_authority');

assert.equal(_testingTenantEvolutionRoutes.boundedInt('999', 50, 1, 100), 100);
assert.equal(_testingTenantEvolutionRoutes.boundedInt('0', 50, 1, 100), 1);
assert.equal(_testingTenantEvolutionRoutes.nonEmptyString('  brand  '), 'brand');
assert.equal(_testingTenantEvolutionRoutes.nonEmptyString('  '), null);

console.log('tenant evolution checkpoint route tests passed');
