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
const proxySource = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
const agentSource = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const installSource = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');
const migrationSource = readFileSync('migrations/165_sprint65_connector_local_api_key_field.sql', 'utf8');

assert(
  'migration adds connector_local_api_key as additive optional registry field',
  migrationSource.includes('ADD COLUMN IF NOT EXISTS `connector_local_api_key` VARCHAR(256) NULL') &&
    migrationSource.includes('AFTER `connector_secret`'),
);

assert(
  'local connector supports multiple configured auth secrets',
  connectorSource.includes('const CONNECTOR_AUTH_SECRETS = [') &&
    connectorSource.includes('CONNECTOR_SECRET,') &&
    connectorSource.includes('CONNECTOR_LOCAL_API_KEY,') &&
    connectorSource.includes('CONNECTOR_AUTH_SECRETS.includes(value)'),
);

assert(
  'legacy backend key fallback is explicit opt-in only',
  connectorSource.includes("CONNECTOR_LEGACY_BACKEND_API_KEY_FALLBACK_ENABLED === 'true'") &&
    connectorSource.includes('LEGACY_BACKEND_API_KEY_FALLBACK_ENABLED ? LEGACY_BACKEND_API_KEY'),
);

assert(
  'connector proxy loads and tries connector_local_api_key without exposing it',
  proxySource.includes('connector_local_api_key') &&
    proxySource.includes('uniqueTruthy([device.connector_secret, device.connector_local_api_key') &&
    !proxySource.includes('connector_local_api_key:'),
);

assert(
  'connector agent installer writes CONNECTOR_LOCAL_API_KEY when configured',
  agentSource.includes('connectorLocalApiKey') &&
    agentSource.includes('CONNECTOR_LOCAL_API_KEY=${String(connectorLocalApiKey).trim()}') &&
    agentSource.includes('connector_local_api_key_configured'),
);

assert(
  'connector agent policy and heartbeat accept connector_local_api_key auth through schema-compatible predicate',
  agentSource.includes('connectorAuthPredicateForToken(token)') &&
    agentSource.includes('params.push(...authPredicate.params)'),
);

const activeProvisioner = installSource.slice(
  installSource.indexOf('export async function provisionLocalConnectorInstall'),
  installSource.indexOf('export function buildLocalConnectorInstallRoutes')
);

assert(
  'legacy install route persists connector_local_api_key and withholds raw key material from JSON responses',
  installSource.includes('connector_local_api_key') &&
    installSource.includes('let connectorLocalApiKey = existing?.connector_local_api_key || null;') &&
    installSource.includes('CONNECTOR_LOCAL_API_KEY=${String(connectorLocalApiKey).trim()}') &&
    installSource.includes('connectorLocalApiKey = connectorLocalApiKey || randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");') &&
    activeProvisioner.includes('short_lived_signed_download_link') &&
    activeProvisioner.includes('raw_material_returned: false') &&
    activeProvisioner.includes('secrets_included: false') &&
    !activeProvisioner.includes('connector_secret: connectorSecret') &&
    !activeProvisioner.includes('install_bat: installScript') &&
    !activeProvisioner.includes('install_ps1: installPowerShell') &&
    !activeProvisioner.includes('".env": connectorEnv'),
);
