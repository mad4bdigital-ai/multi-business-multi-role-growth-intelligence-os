import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentRoutes = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const migration = readFileSync('migrations/161_sprint65_connector_capability_policy_grants.sql', 'utf8');

assert(agentRoutes.includes('loadConnectorGrantPolicy'), 'auth-host policy must load DB-backed connector grant policy');
assert(agentRoutes.includes('local_connector_capability_grants'), 'capability grants must come from local_connector_capability_grants');
assert(agentRoutes.includes('local_connector_app_allowlists'), 'app allowlists must come from local_connector_app_allowlists');
assert(agentRoutes.includes('local_connector_file_access_rules'), 'file grants must reuse local_connector_file_access_rules');
assert(agentRoutes.includes('mergePermissionGrants(dbGrants, payload.permission_grants || {})'), 'installer generation must merge DB grants with token grants');
assert(agentRoutes.includes('capability_grants'), 'policy endpoint must return capability_grants');
assert(agentRoutes.includes('checksumConnectorPolicy'), 'policy checksum must include connector grant policy');
assert(agentRoutes.includes('secrets_included: false'), 'policy endpoint must not include secrets');
assert(agentRoutes.includes('app_aliases: Object.keys(grantPolicy.apps)'), 'policy response must include sanitized app alias summary');

assert(migration.includes('CREATE TABLE IF NOT EXISTS `local_connector_capability_grants`'), 'migration must add capability grants table');
assert(migration.includes('CREATE TABLE IF NOT EXISTS `local_connector_app_allowlists`'), 'migration must add app allowlists table');
assert(migration.includes('powershell_admin'), 'migration must seed powershell capability');
assert(migration.includes('windows_control'), 'migration must seed windows control capability');
assert(migration.includes('dependencies'), 'migration must seed dependencies capability');
assert(migration.includes('auto_browser'), 'migration must seed auto_browser capability');
assert(migration.includes('auto-browser'), 'migration must seed Auto Browser working directory');
assert(migration.includes('Microsoft Edge'), 'migration must seed Edge app grant');
assert(migration.includes('Google Chrome'), 'migration must seed Chrome app grant');
assert(migration.includes('ON DUPLICATE KEY UPDATE'), 'migration seeds must be idempotent');

console.log('db-driven connector capability policy tests passed');
