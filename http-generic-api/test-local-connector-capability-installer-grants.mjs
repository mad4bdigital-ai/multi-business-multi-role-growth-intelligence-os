import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');
const connectorAgentSource = readFileSync('routes/connectorAgentRoutes.js', 'utf8');

assert(source.includes('function cleanText'), 'installer routes must define cleanText for app/helper grant normalization');
assert(source.includes('dependencies: "CONNECTOR_DEPENDENCIES_ENABLED"'), 'dependencies capability must map to connector env flag');
assert(source.includes('auto_browser: "CONNECTOR_AUTO_BROWSER_ENABLED"'), 'auto_browser capability must map to connector env flag');
assert(source.includes('grants.file_paths'), 'permission grants must accept file_paths as an alias for allowed_paths');
assert(source.includes('appGrantValues'), 'permission grants must normalize app grants before iteration');
assert(source.includes('Object.entries(grants.apps || {})'), 'permission grants must support object-shaped app grants');
assert(source.includes('assertNoInstallerAuthorityOverrides(req.body || {})'), 'download-link routes must reject caller-selected installer authority');
assert(source.includes('caller_overrides_allowed: false'), 'download-link responses must disclose DB-only permission authority');
assert(source.includes('capabilities: []'), 'download-link responses must not echo caller-selected capabilities');
assert(!source.includes('permission_grants: permissionGrants'), 'signed installer capabilities must not carry caller-selected permission grants');
assert(source.includes('...connectorCapabilityEnvLines([...capabilities, ...grants.capabilities])'), 'generated .env must include requested capability flags');
assert(!source.includes('`CONNECTOR_SECRET=${connectorSecret}`'), 'generated installer env must not embed the connector secret');
assert(source.includes('CONNECTOR_SECRET_FILE='), 'generated installer env must reference an ACL-restricted connector secret file');
assert(connectorAgentSource.includes('$ConnectorSecretFile'), 'canonical installer must materialize the connector secret directly into its restricted file');
assert(connectorAgentSource.includes('Protect-ConnectorSecretFile $ConnectorSecretFile'), 'canonical installer must restrict the connector secret file ACL');
assert(!source.includes('`BACKEND_API_KEY=${connectorSecret}`'), 'generated .env must not use BACKEND_API_KEY for new local connector installs');
assert(source.includes('CONNECTOR_FILE_PATHS='), 'generated .env must include allowed file paths when granted');
assert(source.includes('CONNECTOR_APP_ALLOWLIST'), 'generated .env must include app allowlist when granted');
assert(source.includes('source: "database_policy"'), 'download-link response must identify the canonical DB permission policy source');

console.log('local connector capability installer grant tests passed');
