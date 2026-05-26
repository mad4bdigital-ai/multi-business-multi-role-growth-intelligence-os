import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = readFileSync('openapi.yaml', 'utf8');

for (const required of [
  '/app/local-manager:',
  '/app/local-manager/admin:',
  '/local-connector/install/download-link:',
  '/connector-agent/manifest.json:',
  '/connect/activate:',
  '/browser-runtime/inspect-site/run:',
  '/connector/{device_id}/browser4:',
]) {
  assert(openapi.includes(required), `openapi.yaml must include ${required}`);
}

assert(openapi.includes('operationId: getLocalManagerApp'), 'Local Manager public app operation must be documented');
assert(openapi.includes('operationId: getLocalManagerAdminTools'), 'Local Manager admin tools operation must be documented');
assert(openapi.includes('operationId: createAdminLocalConnectorInstallerDownloadLink'), 'Admin installer download-link operation must be documented');
assert(openapi.includes('operationId: postConnectorDeviceBrowser4'), 'Browser4 connector proxy operation must be documented');
assert(openapi.includes('operationId: postBrowserRuntimeInspectSiteRun'), 'Browser runtime Browser4 run operation must be documented');
assert(openapi.includes('CONNECTOR_BROWSER4_ENABLED') || openapi.includes('Browser4'), 'OpenAPI must mention Browser4 local adapter context');
assert(openapi.includes('secrets_included: { type: boolean, enum: [false] }'), 'OpenAPI must preserve no-secret response signal for Browser4/local installer paths');
assert(openapi.includes('x-openai-isConsequential: true'), 'State-changing OpenAI-visible operations must be marked consequential');

console.log('openapi local manager/browser4 path tests passed');
