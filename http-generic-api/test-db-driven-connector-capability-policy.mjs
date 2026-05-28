import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentRoutes = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const connector = readFileSync('../local-connector/server.mjs', 'utf8');
const migration = readFileSync('migrations/161_sprint65_connector_capability_policy_grants.sql', 'utf8');

assert(agentRoutes.includes('loadConnectorGrantPolicy'), 'auth-host policy must load DB-backed connector grant policy');
assert(agentRoutes.includes('local_connector_capability_grants'), 'capability grants must come from local_connector_capability_grants');
assert(agentRoutes.includes('local_connector_app_allowlists'), 'app allowlists must come from local_connector_app_allowlists');
assert(agentRoutes.includes('local_connector_file_access_rules'), 'file grants must reuse local_connector_file_access_rules');
assert(agentRoutes.includes('mergePermissionGrants(dbGrants, payload.permission_grants || {})'), 'installer generation must merge DB grants with token grants');
assert(agentRoutes.includes('capability_grants'), 'policy endpoint must return capability_grants');
assert(agentRoutes.includes('checksumConnectorPolicy'), 'policy checksum must include connector grant policy');
assert(agentRoutes.includes('secrets_included: false'), 'policy endpoint must not include secrets');

assert(connector.includes('let PS_ENABLED = ENV_PS_ENABLED'), 'PowerShell enablement must be runtime-refreshable');
assert(connector.includes('let WIN_ENABLED = ENV_WIN_ENABLED'), 'Windows enablement must be runtime-refreshable');
assert(connector.includes('let DEPENDENCIES_ENABLED = ENV_DEPENDENCIES_ENABLED'), 'dependency enablement must be runtime-refreshable');
assert(connector.includes('let AUTO_BROWSER_ENABLED = ENV_AUTO_BROWSER_ENABLED'), 'Auto Browser enablement must be runtime-refreshable');
assert(connector.includes('let FILE_ALLOWLIST = [...ENV_FILE_ALLOWLIST]'), 'file allowlist must be runtime-refreshable');
assert(connector.includes('applyConnectorCapabilityGrants'), 'connector must apply capability grants from policy');
assert(connector.includes("capabilities.includes('powershell_admin')"), 'policy must enable powershell_admin');
assert(connector.includes("capabilities.includes('windows_control')"), 'policy must enable windows_control');
assert(connector.includes("capabilities.includes('dependencies')"), 'policy must enable dependencies');
assert(connector.includes("capabilities.includes('auto_browser')"), 'policy must enable auto_browser');
assert(connector.includes('normalizeRemoteAppAllowlist'), 'connector must normalize app allowlist from policy');
assert(connector.includes('CONNECTOR_GRANT_POLICY_STATE'), 'connector must expose grant policy state');
assert(connector.includes('await refreshShellPolicy();'), 'connector must refresh policy before controlled operations');

assert(migration.includes('CREATE TABLE IF NOT EXISTS `local_connector_capability_grants`'), 'migration must add capability grants table');
assert(migration.includes('CREATE TABLE IF NOT EXISTS `local_connector_app_allowlists`'), 'migration must add app allowlists table');
assert(migration.includes('powershell_admin'), 'migration must seed powershell capability');
assert(migration.includes('windows_control'), 'migration must seed windows control capability');
assert(migration.includes('dependencies'), 'migration must seed dependencies capability');
assert(migration.includes('auto_browser'), 'migration must seed auto_browser capability');
assert(migration.includes('D:\\\\n8n-data\\\\auto-browser'), 'migration must seed Auto Browser working directory');
assert(migration.includes('Microsoft Edge'), 'migration must seed Edge app grant');
assert(migration.includes('Google Chrome'), 'migration must seed Chrome app grant');

console.log('db-driven connector capability policy tests passed');
