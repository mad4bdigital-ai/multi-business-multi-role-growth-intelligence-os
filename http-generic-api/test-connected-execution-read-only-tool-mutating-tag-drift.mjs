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
        tags: "admin,platform-graph,diagnostics,read_only,mutation",
      }]];
    }
    if (String(sql).includes("FROM runtime_dispatch_certification_registry")) {
      return [[]];
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

const result = await buildReadOnlyToolCallPreflight(fakePool, {
  tool_key: "platform_graph_status",
  execute_read_only_tool_call: true,
});

assert.equal(result.allowed, false, "allowlisted GET tool must be blocked when registry tags drift into mutating territory");
assert.deepEqual(result.blockers, ["tool_has_mutating_tag"], "mutating tag drift must produce the mutating-tag blocker only");
assert.equal(result.evidence.tool_key, "platform_graph_status");
assert.equal(result.evidence.allowlist_version, "read_only_tool_call_allowlist_v2");
assert.equal(result.evidence.registry_present, true);
assert.equal(result.evidence.registry_enabled, true);
assert.equal(result.evidence.http_method, "GET");
assert.equal(result.evidence.http_path, "/platform/graph/status");
assert.deepEqual(result.evidence.tags, ["admin", "platform-graph", "diagnostics", "read_only", "mutation"]);
assert.equal(result.evidence.executes_tool_call, false, "preflight must not execute dispatch when mutating tags are present");
assert.equal(result.evidence.preflight_only, true, "blocked mutating-tag drift remains preflight-only");
assert.equal(result.evidence.secrets_included, false);
assert.equal(queries.length, 2, "preflight should only read registry and certification state");

console.log("connected execution read-only tool mutating tag drift diagnostic test passed");
