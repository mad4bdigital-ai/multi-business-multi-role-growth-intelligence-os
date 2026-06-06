import { strict as assert } from "node:assert";
import { buildReadOnlyToolCallPreflight } from "./connectedExecutionWorker.js";

const queries = [];
const fakePool = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (String(sql).includes("FROM admin_platform_endpoint_tools")) {
      return [[{
        tool_key: "platform_graph_status",
        is_enabled: 1,
        http_method: "GET",
        http_path: "/platform/graph/status",
        tags: "admin,platform-graph,diagnostics,read_only",
      }]];
    }
    if (String(sql).includes("FROM runtime_dispatch_certification_registry")) {
      return [[{
        certification_key: "diagnostic_apply_allowed_drift",
        risk_class: "B",
        certification_status: "diagnostic_only",
        dispatch_allowed: 1,
        apply_allowed: 1,
      }]];
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

const result = await buildReadOnlyToolCallPreflight(fakePool, {
  tool_key: "platform_graph_status",
  execute_read_only_tool_call: true,
});

assert.equal(result.allowed, false, "allowlisted GET tool must be blocked when certification drifts to apply_allowed=1");
assert.deepEqual(result.blockers, ["certification_allows_apply"], "apply-enabled certification drift must produce the certification blocker only");
assert.equal(result.evidence.tool_key, "platform_graph_status");
assert.equal(result.evidence.allowlist_version, "read_only_tool_call_allowlist_v2");
assert.equal(result.evidence.registry_present, true);
assert.equal(result.evidence.registry_enabled, true);
assert.equal(result.evidence.http_method, "GET");
assert.equal(result.evidence.http_path, "/platform/graph/status");
assert.deepEqual(result.evidence.tags, ["admin", "platform-graph", "diagnostics", "read_only"]);
assert.deepEqual(result.evidence.certification, {
  certification_key: "diagnostic_apply_allowed_drift",
  risk_class: "B",
  certification_status: "diagnostic_only",
  dispatch_allowed: true,
  apply_allowed: true,
});
assert.equal(result.evidence.executes_tool_call, false, "preflight must not execute dispatch when apply-enabled certification is present");
assert.equal(result.evidence.preflight_only, true, "blocked certification drift remains preflight-only");
assert.equal(result.evidence.secrets_included, false);
assert.equal(queries.length, 2, "preflight should only read registry and certification state");

console.log("connected execution read-only tool apply certification drift diagnostic test passed");
