import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const connectorAgent = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const localManager = readFileSync('routes/localManagerBetaRoutes.js', 'utf8');
const installRoutes = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');
const proxyRoutes = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
const localManagerWindows = readFileSync('../apps/local-manager-windows/Program.cs', 'utf8');

assert(connectorAgent.includes('const AGENT_VERSION = "2026.05.26.1"'), 'connector agent version must move for Local Manager tool releases');
assert(connectorAgent.includes('"browser4-adapter.mjs"'), 'Browser4 adapter must be shipped by connector-agent manifest');
assert(connectorAgent.includes('LOCAL_TOOL_RELEASES'), 'connector-agent manifest must define local tool releases');
assert(connectorAgent.includes('owner_app: "mad4b-local-manager"'), 'Local Manager must own local tool releases');
assert(connectorAgent.includes('release_model: "manifest_driven_allowlisted_tools"'), 'manifest must declare allowlisted tool release model');
assert(connectorAgent.includes('CONNECTOR_BROWSER4_ENABLED=true'), 'installer env must enable Browser4 through Local Manager release');
assert(connectorAgent.includes('BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com'), 'Browser4 install must preserve connector-side domain allowlist');
assert(connectorAgent.includes("Get-Mad4BManifestFile -Name 'browser4-adapter.mjs'"), 'installer must install manifest-declared Browser4 adapter file');
assert(connectorAgent.includes('local_tool_release_owner: "mad4b-local-manager"'), 'upgrade policy must identify Local Manager as tool release owner');

assert(localManager.includes('local release owner for platform tools'), 'public app page must explain Local Manager tool release ownership');
assert(localManager.includes('manifest-driven local tool installation'), 'link flow must explain manifest-driven local tool installation');
assert(localManager.includes('Mad4B Local Manager Admin Tools'), 'admin page must distinguish governed installer tools');

console.log('local manager tool release owner tests passed');
