import { existsSync, readFileSync } from 'node:fs';

function schemaPath(file) {
  const relocated = `openapi/${file}`;
  if (existsSync(relocated)) return relocated;
  return file;
}

function assert(label, condition, detail = '') {
  if (!condition) {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${label}`);
}

const connectorSource = readFileSync('../local-connector/server.mjs', 'utf8');
const connectorSchema = readFileSync(schemaPath('openapi.gpt-action.local-connector.yaml'), 'utf8');

assert(
  'local connector accepts x-api-key as connector-secret alias',
  connectorSource.includes("const apiKeySecret = String(req.headers['x-api-key'] ?? '').trim();") &&
    connectorSource.includes('CONNECTOR_AUTH_SECRETS.includes(value)'),
);

assert(
  'local connector policy advertises x-api-key direct fallback header',
  connectorSource.includes("supported_headers: ['Authorization: Bearer <CONNECTOR_SECRET>', 'x-connector-secret', 'x-api-key']"),
);

assert(
  'local connector policy reports configured auth aliases, not only fallback-only aliases',
  connectorSource.includes('local_api_key_alias_enabled: Boolean(CONNECTOR_LOCAL_API_KEY)') &&
    connectorSource.includes('connector_auth_secret_count: CONNECTOR_AUTH_SECRETS.length') &&
    connectorSource.includes('LEGACY_BACKEND_API_KEY_FALLBACK_ENABLED && Boolean(LEGACY_BACKEND_API_KEY)'),
);

assert(
  'direct connector OpenAPI documents x-api-key as break-glass auth alias',
  connectorSchema.includes('x-api-key: <CONNECTOR_SECRET>') &&
    connectorSchema.includes('connectorBearerAuth'),
);

assert(
  'direct connector schema is explicitly standalone admin break-glass and independent of auth host',
  connectorSchema.includes('Admin-only standalone connector for break-glass access') &&
    connectorSchema.includes('independent of auth.mad4b.com') &&
    connectorSchema.includes('https://connector.mad4b.com'),
);

assert(
  'connector health is intentionally anonymous so reachability does not prove action authentication',
  /\/health:[\s\S]*?operationId:\s*connectorHealth[\s\S]*?security:\s*\[\]/.test(connectorSchema),
);

assert(
  'connector GitHub action requires the connector bearer credential',
  /\/github:[\s\S]*?operationId:\s*connectorGithub[\s\S]*?security:[\s\S]*?- connectorBearerAuth:\s*\[\]/.test(connectorSchema),
);

assert(
  'direct connector auth contract never treats auth-host user credentials as connector action credentials',
  connectorSchema.includes('This standalone admin break-glass credential is independent of auth.mad4b.com.') &&
    !connectorSchema.includes('bearerFormat: User JWT'),
);
