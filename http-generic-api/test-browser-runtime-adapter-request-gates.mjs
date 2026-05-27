import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const governance = readFileSync('browserRuntimeGovernance.js', 'utf8');
const routes = readFileSync('routes/browserRuntimeRoutes.js', 'utf8');
const migration = readFileSync('migrations/146_sprint65_browser_runtime_adapter_request_tools.sql', 'utf8');
const allowlist = readFileSync('openapi-route-coverage.allowlist.json', 'utf8');

assert(governance.includes('createBrowserRuntimeAdapterRequest'), 'governance must expose adapter request creator');
assert(governance.includes('explicit_approval_required'), 'policy must enforce explicit approval gates');
assert(governance.includes('deriveAdapterRequestStatus'), 'adapter requests must derive runtime status');
assert(governance.includes('credential_required_pending_poc'), 'credential-required runtimes must be classified');
assert(governance.includes('candidate_under_review_pending_poc'), 'candidate runtimes must stay candidate-gated');
assert(governance.includes('adapter_poc_required'), 'adapter-pending runtimes must be classified');
assert(governance.includes('browser_runtime_sessions'), 'adapter requests must create sessions');
assert(governance.includes('browser_runtime_events'), 'adapter requests must audit events');
assert(governance.includes('secrets_included: false'), 'adapter requests must not include secrets');

for (const path of [
  '/browser-runtime/visual-takeover/run',
  '/browser-runtime/persistent-session/run',
  '/browser-runtime/cloud-extract/run',
  '/browser-runtime/stealth-extract/run',
]) {
  assert(routes.includes(path), `routes must expose ${path}`);
  assert(allowlist.includes(`POST ${path}`), `${path} must be covered by temporary route allowlist`);
}

assert(routes.includes('auto_browser_takeover_essam'), 'visual takeover route must default to Auto Browser binding');
assert(routes.includes('vessel_persistent_essam'), 'persistent route must default to Vessel binding');
assert(routes.includes('oxylabs_cloud_extraction'), 'cloud route must default to Oxylabs binding');
assert(routes.includes('cloak_browser_stealth_public_extraction_candidate'), 'stealth route must default to CloakBrowser binding');

for (const tool of [
  'browser_runtime_visual_takeover_run',
  'browser_runtime_persistent_session_run',
  'browser_runtime_cloud_extract_run',
  'browser_runtime_stealth_extract_run',
]) {
  assert(migration.includes(tool), `migration must register ${tool}`);
}
assert(migration.includes('policy_gated'), 'new tools must be policy gated');
assert(migration.includes('adapter_pending'), 'new tools must be adapter pending');
assert(migration.includes('candidate_only'), 'CloakBrowser tool must remain candidate only');
assert(migration.includes('credential_pending'), 'Oxylabs tool must remain credential pending');

console.log('browser runtime adapter request gate tests passed');
