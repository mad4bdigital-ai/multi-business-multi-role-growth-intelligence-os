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
assert(routes.includes('TENANT_MUTATION_TOOL_METHODS'), 'tenant mutating HTTP method classifier must be declared');
assert(routes.includes('TENANT_HIGH_RISK_TOOL_NAME_PATTERNS'), 'tenant high-risk tool name guard must be declared');
assert(routes.includes('TENANT_MUTATION_GOVERNANCE_TAGS'), 'tenant mutation governance allow tags must be declared');
assert(routes.includes('TENANT_MUTATION_DENY_TAGS'), 'tenant mutation deny tags must be declared');
assert(routes.includes('evaluateTenantToolVisibility'), 'tenant visibility evaluator must combine path, method, tags, and tool-name guards');
assert(routes.includes('rows.filter((r) => isTenantToolVisible(r))'), 'tenant discovery must use the unified registry policy evaluator');
assert(routes.includes('SELECT http_method, http_path, path_param_keys, fixed_body, tags'), 'tenant dispatch must load registry tags');
assert(routes.includes('evaluateTenantToolVisibility({ tool_key: toolKey, http_method: method, http_path: pathTemplate, tags })'), 'tenant dispatch must evaluate the same registry policy as discovery');
assert(routes.includes('missing_mutation_governance_tag'), 'untagged tenant mutations must fail closed');
assert(routes.includes('tenant_tool_route_not_allowed'), 'tenant blocked dispatch must return stable error code');
assert(routes.includes('lack an explicit tenant governance policy'), 'tenant blocked dispatch must return actionable message');

assert(migration.includes('tenant_platform_endpoint_tools'), 'migration must update tenant tool registry');
assert(migration.includes("`http_path` LIKE '/connector/%'"), 'migration must disable tenant connector workaround paths');
assert(migration.includes("`http_path` LIKE '/admin/%'"), 'migration must disable tenant admin paths');
assert(migration.includes('tenant surface must not dispatch User JWT callers'), 'migration must document tenant auth contract');
assert(toolBusMigration.includes("http_path IN ('/system/tools/call', '/gpt/tools/call')"), 'tool bus migration must disable tenant self-recursive dispatcher wrappers');
assert(toolBusMigration.includes('runtime_endpoint_call_kernel_v1'), 'tool bus migration must register runtime_endpoint_call kernel dispatch certification');
assert(toolBusMigration.includes('v_platform_exports_current_v2'), 'tool bus migration must expose v2 export coverage view');
assert(toolBusMigration.includes('platform_endpoint_tool_exports'), 'v2 export view must include platform endpoint exports');

console.log('tenant tool surface guard tests passed');
