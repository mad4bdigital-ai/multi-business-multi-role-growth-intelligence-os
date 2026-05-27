import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/platformEvolutionRoutes.js', 'utf8');
const indexFile = readFileSync('routes/index.js', 'utf8');
const migration = readFileSync('migrations/155_sprint65_platform_evolution_checkpoint_tools.sql', 'utf8');

assert(routeFile.includes('export function buildPlatformEvolutionRoutes'), 'platform evolution route builder must be exported');
assert(routeFile.includes('/platform/evolution/activation-card'), 'activation card route must exist');
assert(routeFile.includes('/platform/evolution/thread-map'), 'thread map route must exist');
assert(routeFile.includes('/platform/evolution/open-evidence'), 'open evidence route must exist');
assert(routeFile.includes('/platform/evolution/checkpoints'), 'checkpoint create route must exist');
assert(routeFile.includes('v_platform_evolution_activation_card'), 'activation card view must be used');
assert(routeFile.includes('v_platform_evolution_thread_map'), 'thread map view must be used');
assert(routeFile.includes('v_platform_evolution_open_evidence'), 'open evidence view must be used');
assert(routeFile.includes('platform_evolution_checkpoints'), 'checkpoint table must be used');
assert(routeFile.includes('platform_evolution_threads'), 'thread table must be updated after checkpoint creation');
assert(routeFile.includes('secrets_included: false'), 'routes must explicitly avoid secret return');

assert(indexFile.includes('buildPlatformEvolutionRoutes'), 'route index must import/register platform evolution routes');
assert(indexFile.includes('app.use(buildPlatformEvolutionRoutes({ ...deps, requireAdminPrincipal }))'), 'platform evolution routes must be admin protected');

for (const toolKey of [
  'platform_evolution_activation_card',
  'platform_evolution_thread_map',
  'platform_evolution_open_evidence',
  'platform_evolution_checkpoint_create',
]) {
  assert(migration.includes(toolKey), `${toolKey} must be registered as an admin platform endpoint tool`);
}

assert(migration.includes('scope_gated'), 'tools must be tagged scope_gated');
assert(migration.includes('no_secrets'), 'tools must be tagged no_secrets');

console.log('platform evolution checkpoint tool tests passed');
