import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentRoutes = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const connector = readFileSync('../local-connector/server.mjs', 'utf8');
const migration = readFileSync('migrations/159_sprint65_db_driven_connector_shell_policy.sql', 'utf8');
const allowlist = readFileSync('openapi-route-coverage.allowlist.json', 'utf8');

assert(agentRoutes.includes('/connector-agent/policy'), 'auth-host must expose connector-agent policy endpoint');
assert(agentRoutes.includes('local_connector_shell_allowlists'), 'policy endpoint must read local_connector_shell_allowlists');
assert(agentRoutes.includes('connector_secret = ?'), 'policy endpoint must authenticate using connector secret');
assert(agentRoutes.includes('normalizeShellPolicyRow'), 'policy endpoint must normalize shell policy rows');
assert(agentRoutes.includes('tokenizeCommandTemplate'), 'policy endpoint must parse command_template safely');
assert(agentRoutes.includes('cmd.exe'), 'cmd /c command templates must be emitted as cmd.exe with args');
assert(agentRoutes.includes('checksumShellPolicy'), 'policy endpoint must return a checksum');
assert(agentRoutes.includes('policy_version'), 'policy endpoint must return policy version metadata');
assert(agentRoutes.includes('secrets_included: false'), 'policy endpoint must not return secrets');

assert(connector.includes('CONNECTOR_POLICY_URL'), 'local connector must define policy URL');
assert(connector.includes('CONNECTOR_POLICY_TTL_MS'), 'local connector must define policy TTL');
assert(connector.includes('refreshShellPolicy'), 'local connector must pull dynamic shell policy');
assert(connector.includes('normalizeRemoteShellAliases'), 'local connector must normalize remote aliases');
assert(connector.includes('SHELL_POLICY_STATE'), 'local connector must expose loaded policy state');
assert(connector.includes('await refreshShellPolicy();'), 'local connector must refresh policy before policy/shell responses');
assert(connector.includes("source: 'db'"), 'successful policy pull must mark DB source');
assert(connector.includes('env_fallback_policy_pull_failed'), 'connector must retain env fallback on policy pull failures');
assert(connector.includes('X-Mad4B-Connector-Hostname'), 'policy pull must identify connector hostname without sending secrets in body');

assert(migration.includes('status'), 'migration must add status metadata');
assert(migration.includes('risk_class'), 'migration must add risk_class metadata');
assert(migration.includes('policy_version'), 'migration must add policy_version metadata');
assert(migration.includes('repo_status_growth_os'), 'migration must seed repo status alias');
assert(migration.includes('repo_diff_name_status_growth_os'), 'migration must seed repo diff alias');
assert(migration.includes('uq_lc_shell_policy_config_alias'), 'migration must enforce config+alias upsert key');
assert(allowlist.includes('GET /connector-agent/policy'), 'internal policy route must be route-coverage allowlisted');

console.log('db-driven connector shell policy tests passed');
