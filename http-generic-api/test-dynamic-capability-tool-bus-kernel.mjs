import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const systemLayerRoutes = readFileSync('routes/systemLayerRoutes.js', 'utf8');
const gptToolsRoutes = readFileSync('routes/gptToolsRoutes.js', 'utf8');
const taxonomy = readFileSync('../docs/registry-taxonomy.md', 'utf8');
const migration = readFileSync('migrations/270_sprint68_dynamic_capability_tool_bus_kernel.sql', 'utf8');

assert(systemLayerRoutes.includes('name: "runtime_endpoint_call"'), 'runtime_endpoint_call must be registered as a kernel SYSTEM_LAYER_TOOL');
assert(systemLayerRoutes.includes('case "runtime_endpoint_call"'), 'runtime_endpoint_call must dispatch through callSystemLayerTool switch, not a DB wrapper');
assert(systemLayerRoutes.includes('_principal_context_guard: guarded.guard'), 'runtime_endpoint_call must preserve principal context guard in facade calls');
assert(systemLayerRoutes.includes('target_key: { type: "string" }'), 'runtime_endpoint_call schema must expose target_key for Brand Registry resolution');
assert(systemLayerRoutes.includes('brand_key: { type: "string" }'), 'runtime_endpoint_call schema must expose brand_key for Brand Registry resolution');
assert(systemLayerRoutes.includes('brand_domain: { type: "string" }'), 'runtime_endpoint_call schema must expose brand_domain for Brand Registry resolution');

assert(gptToolsRoutes.includes('"/system/tools/call"'), 'tenant manual tools must block recursive /system/tools/call dispatch');
assert(gptToolsRoutes.includes('"/gpt/tools/call"'), 'tenant manual tools must block recursive /gpt/tools/call dispatch');

assert(taxonomy.includes('platform_endpoint_tool_exports'), 'registry taxonomy must define platform endpoint exports');
assert(taxonomy.includes('manual dispatcher tool registries'), 'registry taxonomy must distinguish manual dispatcher tool registries');
assert(taxonomy.includes('They are not replacements for `platform_endpoint_tool_exports`.'), 'taxonomy must forbid treating manual tool tables as endpoint export replacements');

assert(migration.includes('self_recursive_dispatch_blocked'), 'migration must mark disabled recursive wrappers');
assert(migration.includes('runtime_endpoint_call_kernel_v1'), 'migration must register runtime endpoint call kernel certification');
assert(migration.includes('platform_endpoint_tool_export'), 'migration v2 export view must project platform endpoint exports');

console.log('dynamic capability tool bus kernel tests passed');
