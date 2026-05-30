import { readFileSync } from 'node:fs';

function assert(label, condition, detail = '') {
  if (!condition) {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${label}`);
}

const credentialRoutes = readFileSync('routes/credentialRoutes.js', 'utf8');
const migration = readFileSync('migrations/171_sprint65_local_connector_key_promotion_tool.sql', 'utf8');

assert(
  'local connector key promotion route is registered',
  credentialRoutes.includes('router.post("/credentials/intake/promote-local-connector-key"') &&
    credentialRoutes.includes('local_connector_user_configs') &&
    credentialRoutes.includes('connector_local_api_key'),
);

assert(
  'promotion route decrypts server-side and never returns the secret',
  credentialRoutes.includes('decryptCredentials(connection.encrypted_credentials)') &&
    credentialRoutes.includes('value_sha256: hash') &&
    credentialRoutes.includes('secrets_included: false') &&
    !credentialRoutes.includes('secret: value') &&
    !credentialRoutes.includes('connector_local_api_key: value'),
);

assert(
  'promotion route is scoped to one active user tenant device config',
  credentialRoutes.includes('WHERE user_id = ?') &&
    credentialRoutes.includes('AND tenant_id = ?') &&
    credentialRoutes.includes('AND device_id = ?') &&
    credentialRoutes.includes('AND is_enabled = 1') &&
    credentialRoutes.includes('LIMIT 1'),
);

assert(
  'promotion tool is registered in admin tool registry with no-secrets tags',
  migration.includes("'credential_intake_promote_local_connector_key'") &&
    migration.includes("'/credentials/intake/promote-local-connector-key'") &&
    migration.includes('state_changing') &&
    migration.includes('no_secrets'),
);

console.log('local connector key promotion tests passed');
