import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync('routes/gptToolsRoutes.js', 'utf8');
const systemLayerRoutes = readFileSync('routes/systemLayerRoutes.js', 'utf8');
const migration = readFileSync('migrations/165_sprint65_hard_activation_and_tenant_surface.sql', 'utf8');
const toolBusMigration = readFileSync('migrations/270_sprint68_dynamic_capability_tool_bus_kernel.sql', 'utf8');

assert(routes.includes('TENANT_BLOCKED_TOOL_PATH_PREFIXES'), 'tenant blocked path prefixes must be declared');
assert(routes.includes('"/admin/"'), 'tenant guard must block admin routes');
assert(routes.includes('"/admin/system/"'), 'tenant guard must block admin system routes');
assert(routes.includes('"/connector/"'), 'tenant guard must block connector workaround routes');
assert(routes.includes('"/system/tools/call"'), 'tenant guard must block recursive system tool dispatcher routes');
assert(routes.includes('"/gpt/tools/call"'), 'tenant guard must block recursive GPT tool dispatcher routes');
assert(routes.includes('TENANT_BLOCKED_TOOL_NAMES'), 'tenant guard must declare blocked state-changing tool names');
assert(routes.includes('"github_api_mcp__github_put_contents"'), 'tenant guard must block direct GitHub PUT export by name');
assert(routes.includes('"github_api_mcp__github_delete_file"'), 'tenant guard must block direct GitHub delete export by name');
assert(routes.includes('isTenantBlockedToolPath'), 'tenant blocked path helper must exist');
assert(routes.includes('isTenantBlockedToolName'), 'tenant blocked tool-name helper must exist');
assert(routes.includes('!isTenantBlockedToolName(r.tool_key)'), 'tenant discovery must filter blocked state-changing tool names');
assert(routes.includes('callerType === "tenant" && (isTenantBlockedToolPath(pathTemplate) || isTenantBlockedToolName(toolKey))'), 'tenant dispatch must enforce blocked path and tool-name guard');
assert(routes.includes('tenant_tool_route_not_allowed'), 'tenant blocked dispatch must return stable error code');
assert(routes.includes('Tenant GPT tools cannot dispatch admin-only or state-changing platform routes'), 'tenant blocked dispatch must return actionable message');

assert(migration.includes('tenant_platform_endpoint_tools'), 'migration must update tenant tool registry');
assert(migration.includes("`http_path` LIKE '/connector/%'"), 'migration must disable tenant connector workaround paths');
assert(migration.includes("`http_path` LIKE '/admin/%'"), 'migration must disable tenant admin paths');
assert(migration.includes('tenant surface must not dispatch User JWT callers'), 'migration must document tenant auth contract');
assert(toolBusMigration.includes("http_path IN ('/system/tools/call', '/gpt/tools/call')"), 'tool bus migration must disable tenant self-recursive dispatcher wrappers');
assert(toolBusMigration.includes('runtime_endpoint_call_kernel_v1'), 'tool bus migration must register runtime_endpoint_call kernel dispatch certification');
assert(toolBusMigration.includes('v_platform_exports_current_v2'), 'tool bus migration must expose v2 export coverage view');
assert(toolBusMigration.includes('platform_endpoint_tool_exports'), 'v2 export view must include platform endpoint exports');

assert.match(
  systemLayerRoutes,
  /name: "runtime_endpoint_call",[\s\S]*?requires_admin: true,/,
  'runtime_endpoint_call must be admin-only so tenant discovery cannot expose provider execution'
);
assert(
  systemLayerRoutes.includes('TENANT_BLOCKED_SYSTEM_TOOL_NAMES'),
  'system facade must declare tenant-blocked state-changing tool names'
);
assert(
  systemLayerRoutes.includes('"github_api_mcp__github_put_contents"') && systemLayerRoutes.includes('"github_api_mcp__github_delete_file"'),
  'system facade must block direct GitHub write/delete exports by name'
);
assert(
  systemLayerRoutes.includes('tool.requires_admin !== true && !TENANT_BLOCKED_SYSTEM_TOOL_NAMES.has(tool.name)'),
  'tenant system tool discovery must hide admin-only and blocked kernel tools'
);
assert(
  systemLayerRoutes.includes('tenant_system_tool_route_not_allowed'),
  'tenant system tool dispatch must reject blocked registry exports before runtime facade execution'
);
assert(
  systemLayerRoutes.indexOf('assertAdminToolAccess(name, auth);') < systemLayerRoutes.indexOf('case "runtime_endpoint_call"'),
  'runtime_endpoint_call must pass admin access guard before provider dispatch'
);

console.log('tenant tool surface guard tests passed');
