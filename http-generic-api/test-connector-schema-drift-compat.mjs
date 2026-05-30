import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  connectorAuthPredicateForToken,
  connectorLocalApiKeySelectFragment,
  resetConnectorSchemaCompatibilityCache,
  tableColumnExists,
} from './connectorSchemaCompatibility.js';

function fakePool(columnExists) {
  return {
    async query(sql, params) {
      assert(String(sql).includes('INFORMATION_SCHEMA.COLUMNS'), 'schema compatibility must inspect INFORMATION_SCHEMA.COLUMNS');
      assert.deepEqual(params, ['local_connector_user_configs', 'connector_local_api_key']);
      return [[{ column_count: columnExists ? 1 : 0 }]];
    },
  };
}

resetConnectorSchemaCompatibilityCache();
assert.equal(await tableColumnExists('local_connector_user_configs', 'connector_local_api_key', fakePool(true)), true);
resetConnectorSchemaCompatibilityCache();
assert.equal(await connectorLocalApiKeySelectFragment(fakePool(false)), 'NULL AS connector_local_api_key');
resetConnectorSchemaCompatibilityCache();
assert.equal(await connectorLocalApiKeySelectFragment(fakePool(true)), 'connector_local_api_key');

resetConnectorSchemaCompatibilityCache();
const fallbackPredicate = await connectorAuthPredicateForToken('token-1', fakePool(false));
assert.equal(fallbackPredicate.sql, 'connector_secret = ?');
assert.deepEqual(fallbackPredicate.params, ['token-1']);
assert.equal(fallbackPredicate.connector_local_api_key_supported, false);

resetConnectorSchemaCompatibilityCache();
const localKeyPredicate = await connectorAuthPredicateForToken('token-1', fakePool(true));
assert.equal(localKeyPredicate.sql, '(connector_secret = ? OR connector_local_api_key = ?)');
assert.deepEqual(localKeyPredicate.params, ['token-1', 'token-1']);
assert.equal(localKeyPredicate.connector_local_api_key_supported, true);

const proxySource = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
const agentSource = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const installSource = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');

assert(proxySource.includes('connectorLocalApiKeySelectFragment'), 'proxy config SELECT must tolerate missing connector_local_api_key column');
assert(proxySource.includes('LOWER(alias_device_id) = ?'), 'device aliases must resolve case-insensitively');
assert(proxySource.includes("tenant_id = '00000000-0000-0000-0000-000000000000'"), 'alias resolution must support platform/global tenant aliases');
assert(agentSource.includes('connectorAuthPredicateForToken(token)'), 'agent policy/heartbeat auth must not hard-reference optional local key column');
assert(agentSource.includes('connectorLocalApiKeySelectFragment'), 'agent installer SELECT must use the optional local key select helper');
assert(installSource.includes('connectorLocalApiKeyColumnSupported'), 'install route must branch writes based on optional column availability');
assert(installSource.includes('connectorLocalApiKeySelectFragment'), 'install route SELECT must use the optional local key select helper');

console.log('connector schema drift compatibility tests passed');
