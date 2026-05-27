import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');

assert(source.includes('function cleanText'), 'installer routes must define cleanText for app/helper grant normalization');
assert(source.includes('dependencies: "CONNECTOR_DEPENDENCIES_ENABLED"'), 'dependencies capability must map to connector env flag');
assert(source.includes('auto_browser: "CONNECTOR_AUTO_BROWSER_ENABLED"'), 'auto_browser capability must map to connector env flag');
assert(source.includes('grants.file_paths'), 'permission grants must accept file_paths as an alias for allowed_paths');
assert(source.includes('appGrantValues'), 'permission grants must normalize app grants before iteration');
assert(source.includes('Object.entries(grants.apps || {})'), 'permission grants must support object-shaped app grants');
assert(source.includes('const permissionGrants = normalizePermissionGrants({ ...(req.body?.permission_grants || {}), capabilities: req.body?.capabilities || [] });'), 'admin download-link must normalize requested permission grants');
assert(source.includes('const capabilities = permissionGrants.capabilities;'), 'admin download-link must derive accepted capabilities from normalized grants');
assert(source.includes('permission_grants: permissionGrants'), 'signed installer tokens must carry permission grants');
assert(source.includes('capabilities,\n        permission_grants: permissionGrants'), 'signed admin installer tokens must carry capabilities and permission grants');
assert(source.includes('const permissionGrants = normalizePermissionGrants(payload.permission_grants || { capabilities: payload.capabilities || [] });'), 'download endpoint must rebuild installer env from signed token grants');
assert(source.includes('...connectorCapabilityEnvLines([...capabilities, ...grants.capabilities])'), 'generated .env must include requested capability flags');
assert(source.includes('CONNECTOR_FILE_PATHS='), 'generated .env must include allowed file paths when granted');
assert(source.includes('CONNECTOR_APP_ALLOWLIST'), 'generated .env must include app allowlist when granted');
assert(!source.includes('cleanText is not defined'), 'test guard sanity check');

console.log('local connector capability installer grant tests passed');
