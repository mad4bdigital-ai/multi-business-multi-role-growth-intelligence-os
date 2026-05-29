import { readFileSync } from 'node:fs';

function assert(label, condition, detail = '') {
  if (!condition) {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${label}`);
}

const connectorSource = readFileSync('../local-connector/server.mjs', 'utf8');
const connectorSchema = readFileSync('openapi.gpt-action.local-connector.yaml', 'utf8');

assert(
  'local connector accepts x-api-key as connector-secret alias',
  connectorSource.includes("const apiKeySecret = String(req.headers['x-api-key'] ?? '').trim();") &&
    connectorSource.includes('apiKeySecret === CONNECTOR_AUTH_SECRET'),
);

assert(
  'local connector policy advertises x-api-key direct fallback header',
  connectorSource.includes("supported_headers: ['Authorization: Bearer <CONNECTOR_SECRET>', 'x-connector-secret', 'x-api-key']"),
);

assert(
  'direct connector OpenAPI documents x-api-key as break-glass auth alias',
  connectorSchema.includes('x-api-key: <CONNECTOR_SECRET>') &&
    connectorSchema.includes('connectorBearerAuth'),
);
