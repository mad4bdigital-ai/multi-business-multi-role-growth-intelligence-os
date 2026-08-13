import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TENANT_TOOL_EXPORTABLE_MANIFEST_STATUSES,
  assertTenantToolManifestAllows,
  buildTenantToolManifestBlocks,
  filterTenantToolsByManifest,
  loadTenantToolManifestBlocks,
} from "./tenantToolManifestGuard.js";

assert.deepEqual(TENANT_TOOL_EXPORTABLE_MANIFEST_STATUSES, [
  "shadow_ready",
  "active",
  "certified",
]);

const blocked = buildTenantToolManifestBlocks([
  { tool_key: "blocked_tool", manifest_status: "blocked" },
  { tool_key: "future_unknown_tool", manifest_status: "pending_review" },
  { tool_key: "shadow_tool", manifest_status: "shadow_ready" },
  { tool_key: "active_tool", manifest_status: "active" },
  { tool_key: "certified_tool", manifest_status: "certified" },
]);

assert.deepEqual([...blocked.entries()], [
  ["blocked_tool", "blocked"],
  ["future_unknown_tool", "pending_review"],
]);

const visible = filterTenantToolsByManifest([
  { tool_key: "blocked_tool" },
  { tool_key: "future_unknown_tool" },
  { tool_key: "shadow_tool" },
  { tool_key: "unmanifested_tool" },
], blocked);
assert.deepEqual(visible.map((row) => row.tool_key), ["shadow_tool", "unmanifested_tool"]);

assert.doesNotThrow(() => assertTenantToolManifestAllows("admin", "blocked_tool", blocked));
assert.doesNotThrow(() => assertTenantToolManifestAllows("tenant", "shadow_tool", blocked));
assert.doesNotThrow(() => assertTenantToolManifestAllows("tenant", "unmanifested_tool", blocked));
assert.throws(
  () => assertTenantToolManifestAllows("tenant", "blocked_tool", blocked),
  (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "tenant_tool_capability_blocked");
    assert.deepEqual(error.details, {
      tool_key: "blocked_tool",
      manifest_status: "blocked",
    });
    return true;
  }
);

let observedSql = "";
let observedParams = null;
const loaded = await loadTenantToolManifestBlocks({
  async query(sql, params) {
    observedSql = sql;
    observedParams = params;
    return [[
      { tool_key: "blocked_tool", manifest_status: "blocked" },
      { tool_key: "shadow_tool", manifest_status: "shadow_ready" },
    ]];
  },
});
assert.equal(loaded.get("blocked_tool"), "blocked");
assert.equal(loaded.has("shadow_tool"), false);
assert.match(observedSql, /platform_capability_compiled_manifests/);
assert.match(observedSql, /is_current = 1/);
assert.deepEqual(observedParams, ["tenant_tool.", "tenant_tool.", "tenant_tool."]);

const routeSource = fs.readFileSync("./routes/gptToolsRoutes.js", "utf8");
assert.match(routeSource, /sqlCacheKey\("tools", callerType, "list", "v3"\)/);
assert.doesNotMatch(routeSource, /sqlCacheKey\("tools", callerType, "list", "v1"\)/);
assert.match(routeSource, /filterTenantToolsByManifest\(/);
assert.match(routeSource, /assertTenantToolManifestAllows\(callerType, toolKey, blockedTenantManifests\)/);
assert.match(routeSource, /secrets_included: false/);

const dispatchSource = routeSource.slice(routeSource.indexOf("async function dispatchTool(callerType, toolKey, args, req, runtimeDeps = {})"));
const dispatchGuardIndex = dispatchSource.indexOf("assertTenantToolManifestAllows(callerType, toolKey, blockedTenantManifests)");
const preflightIndex = dispatchSource.indexOf("resolveToolPreflightDescriptor(callerType, toolKey)");
assert.ok(dispatchGuardIndex >= 0 && dispatchGuardIndex < preflightIndex, "manifest guard must run before dispatch preflight");

console.log("Tenant tool manifest guard tests passed.");
