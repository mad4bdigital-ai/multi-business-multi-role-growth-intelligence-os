import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync('routes/gptToolsRoutes.js', 'utf8');
const migration = readFileSync('migrations/165_sprint65_hard_activation_and_tenant_surface.sql', 'utf8');
const toolBusMigration = readFileSync('migrations/270_sprint68_dynamic_capability_tool_bus_kernel.sql', 'utf8');

assert(routes.includes('TENANT_BLOCKED_TOOL_PATH_PREFIXES'), 'tenant blocked path prefixes must be declared');
assert(routes.includes('"/admin/"'), 'tenant guard must block admin routes');
assert(routes.includes('"/admin/system/"'), 'tenant guard must block admin system routes');
assert(routes.includes('"/connector/"'), 'tenant guard must block connector workaround routes');
assert(routes.includes('"/system/tools/call"'), 'tenant guard must block recursive system tool dispatcher routes');
assert(routes.includes('"/gpt/tools/call"'), 'tenant guard must block recursive GPT tool dispatcher routes');
assert(routes.includes('isTenantBlockedToolPath'), 'tenant blocked path helper must exist');
assert(routes.includes('rows.filter((r) => !isTenantBlockedToolPath(r.http_path))'), 'tenant discovery must filter blocked paths');
assert(routes.includes('callerType === "tenant" && isTenantBlockedToolPath(pathTemplate)'), 'tenant dispatch must enforce blocked path guard');
assert(routes.includes('tenant_tool_route_not_allowed'), 'tenant blocked dispatch must return stable error code');
assert(routes.includes('Tenant GPT tools cannot dispatch to admin-only connector workaround routes'), 'tenant blocked dispatch must return actionable message');

assert(migration.includes('tenant_platform_endpoint_tools'), 'migration must update tenant tool registry');
assert(migration.includes("`http_path` LIKE '/connector/%'"), 'migration must disable tenant connector workaround paths');
assert(migration.includes("`http_path` LIKE '/admin/%'"), 'migration must disable tenant admin paths');
assert(migration.includes('tenant surface must not dispatch User JWT callers'), 'migration must document tenant auth contract');
assert(toolBusMigration.includes("http_path IN ('/system/tools/call', '/gpt/tools/call')"), 'tool bus migration must disable tenant self-recursive dispatcher wrappers');
assert(toolBusMigration.includes('runtime_endpoint_call_kernel_v1'), 'tool bus migration must register runtime_endpoint_call kernel dispatch certification');
assert(toolBusMigration.includes('v_platform_exports_current_v2'), 'tool bus migration must expose v2 export coverage view');
assert(toolBusMigration.includes('platform_endpoint_tool_exports'), 'v2 export view must include platform endpoint exports');

console.log('tenant tool surface guard tests passed');
