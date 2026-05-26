import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const connectRoutes = readFileSync('routes/connectRoutes.js', 'utf8');

assert(connectRoutes.includes('LOCAL_MANAGER_ACTIVATION_BINDING'), 'connect routes must define Local Manager activation binding');
assert(connectRoutes.includes('role: "local_tool_release_owner"'), 'Local Manager binding must identify local tool release owner role');
assert(connectRoutes.includes('public_app_url: "/app/local-manager"'), 'binding must expose public Local Manager app URL');
assert(connectRoutes.includes('admin_tools_url: "/app/local-manager/admin"'), 'binding must expose admin Local Manager tools URL');
assert(connectRoutes.includes('manifest_url: "/connector-agent/manifest.json"'), 'binding must expose connector agent manifest URL');
assert(connectRoutes.includes('installer_download_link_endpoint: "/local-connector/install/download-link"'), 'binding must expose installer download-link endpoint');
assert(connectRoutes.includes('release_model: "manifest_driven_allowlisted_tools"'), 'binding must expose manifest-driven tool release model');
assert(connectRoutes.includes('managed_tools: ["browser4"]'), 'binding must include Browser4 as a managed local tool');
assert(connectRoutes.includes('local_manager_activation_binding: localManagerActivationBinding()'), 'policy/status/capabilities/activate responses must expose Local Manager binding');
assert(connectRoutes.includes('["open_local_manager", "connect_device_install"]'), 'activate success must route users to Local Manager before device install fallback');
assert(connectRoutes.includes('local_manager_activation_binding'), 'connect activate response must be bound to Local Manager');
assert(tenantSchema.includes('/connect/activate'), 'tenant GPT schema must expose connect activate');

console.log('local manager activate binding tests passed');
