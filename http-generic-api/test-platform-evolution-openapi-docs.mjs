import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = readFileSync('openapi.yaml', 'utf8');
const allowlist = readFileSync('openapi-route-coverage.allowlist.json', 'utf8');

for (const path of [
  '/platform/evolution/activation-card',
  '/platform/evolution/thread-map',
  '/platform/evolution/open-evidence',
  '/platform/evolution/checkpoints',
  '/tenant/evolution/checkpoints',
  '/tenant/evolution/activation-card',
  '/tenant/evolution/thread-map',
  '/tenant/evolution/open-evidence',
]) {
  assert(openapi.includes(`${path}:`), `${path} must be documented in openapi.yaml`);
  assert(!allowlist.includes(path), `${path} must not remain in route coverage allowlist`);
}

for (const schema of [
  'PlatformEvolutionActivationCard',
  'PlatformEvolutionActivationCardResponse',
  'PlatformEvolutionThreadMapItem',
  'PlatformEvolutionThreadMapResponse',
  'PlatformEvolutionOpenEvidenceItem',
  'PlatformEvolutionOpenEvidenceResponse',
  'PlatformEvolutionCheckpointCreateRequest',
  'PlatformEvolutionCheckpointCreateResponse',
]) {
  assert(openapi.includes(`${schema}:`), `${schema} must be documented as an OpenAPI schema`);
}

assert(openapi.includes('- name: platform-evolution'), 'platform-evolution tag must be documented');
assert(!allowlist.includes('routes/platformEvolutionRoutes.js'), 'platformEvolutionRoutes.js must not remain allowlisted');
assert(!allowlist.includes('routes/tenantEvolutionRoutes.js'), 'tenantEvolutionRoutes.js must not remain allowlisted');
assert(openapi.includes('operationId: platformEvolutionActivationCard'), 'admin activation card operationId must exist');
assert(openapi.includes('operationId: tenantEvolutionActivationCard'), 'tenant activation card operationId must exist');
assert(openapi.includes('operationId: platformEvolutionCheckpointCreate'), 'checkpoint create operationId must exist');
assert(openapi.includes('User JWT required'), 'tenant auth failure response must be documented');
assert(openapi.includes('scope_key'), 'scope_key parameter must be documented');
assert(openapi.includes('secrets_included'), 'secret-free response field must be documented');

console.log('platform evolution OpenAPI docs tests passed');
