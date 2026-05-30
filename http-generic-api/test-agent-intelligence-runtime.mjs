import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCanonicalModelRunEvents,
  buildCanonicalModelRunPlan,
  searchAgentTools,
} from "./agentIntelligenceRuntime.js";

const routesIndex = fs.readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const agentRoutes = fs.readFileSync(new URL("./routes/agentIntelligenceRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const toolsMigration = fs.readFileSync(new URL("./migrations/167_sprint65_ai_intelligence_runtime_governance_tools.sql", import.meta.url), "utf8");

assert(routesIndex.includes("buildAgentIntelligenceRoutes"));
assert(agentRoutes.includes('router.post("/ai/model-runs"'));
assert(agentRoutes.includes('router.get("/ai/model-runs/:id/events"'));
assert(agentRoutes.includes('router.post("/ai/tool-search"'));
assert(openapi.includes("/ai/model-runs:"));
assert(openapi.includes("/ai/model-runs/{id}/events:"));
assert(openapi.includes("/ai/tool-search:"));
assert(toolsMigration.includes("ai_model_run_plan"));
assert(toolsMigration.includes("ai_model_run_events"));
assert(toolsMigration.includes("ai_tool_search"));
assert(toolsMigration.includes("no_model_call"));
assert(toolsMigration.includes("no_tool_execution"));
assert(toolsMigration.includes("no_raw_catalog"));

const plan = buildCanonicalModelRunPlan({
  provider_key: "anthropic_like",
  model_key: "test-model",
  messages: [
    { role: "user", content: "Plan this safely." },
    {
      role: "assistant",
      content: [
        { type: "thinking_metadata", metadata: { token_count: 12, api_key: "must-redact" } },
        { type: "tool_use", name: "repo_inspect", input: { path: "README.md" } },
      ],
    },
  ],
});

assert.equal(plan.ok, true);
assert.equal(plan.will_call_model, false);
assert.equal(plan.model_executes_tools, false);
assert.equal(plan.tool_execution_runtime_separate, true);
assert.equal(plan.raw_tool_catalog_exposed, false);
assert.equal(plan.no_raw_thinking_stored, true);
assert.equal(plan.input_message_summary[1].content_block_types.includes("thinking_metadata"), true);
assert.equal(plan.hard_gates.model_may_override, false);
assert.equal(plan.hard_gates.readback_required_for_side_effects, true);

const planJson = JSON.stringify(plan);
assert(!planJson.includes("must-redact"));
assert(planJson.includes("[redacted]"));

const events = buildCanonicalModelRunEvents(plan);
assert.equal(events.ok, true);
assert.equal(events.event_stream_type, "canonical_agent_runtime_events_v1");
assert(events.events.some((event) => event.event === "policy.loaded"));
assert(events.events.some((event) => event.event === "model.started" && event.status === "not_started_dry_run"));

const search = await searchAgentTools({
  query: "registry",
  limit: 10,
  tools: [
    {
      tool_key: "platform_engine_list",
      display_name: "Platform Engine List",
      description: "List policy-driven platform engines.",
      http_method: "GET",
      http_path: "/platform/engines",
      tags: "platform_engine,registry,read_only",
    },
    {
      tool_key: "danger_drop",
      display_name: "Danger Drop",
      description: "DROP TABLE",
      http_method: "POST",
      http_path: "/danger/drop",
      tags: "destructive",
    },
  ],
});

assert.equal(search.ok, true);
assert.equal(search.raw_catalog_exposed, false);
assert.equal(search.count, 1);
assert.equal(search.tools[0].tool_key, "platform_engine_list");
assert.equal(search.tools[0].risk_class, "read_only");
assert.equal(search.tools[0].raw_manifest_exposed, false);

const destructive = await searchAgentTools({
  risk_class: "destructive",
  tools: [
    {
      tool_key: "danger_drop",
      display_name: "Danger Drop",
      description: "DROP TABLE",
      http_method: "POST",
      http_path: "/danger/drop",
      tags: "destructive",
    },
  ],
});

assert.equal(destructive.count, 1);
assert.equal(destructive.tools[0].risk_class, "destructive");

const indexedSearch = await searchAgentTools(
  { query: "release", limit: 5 },
  {
    pool: {
      async query(sql) {
        assert(String(sql).includes("agent_tool_index"), "indexed tool search must read from agent_tool_index first");
        return [[
          {
            tool_key: "release_readiness",
            display_name: "Release Readiness",
            source_truth_resource_type: "endpoint",
            source_truth_resource_key: "release_readiness",
            tool_manifest_json: JSON.stringify({
              description: "Full platform release readiness check.",
              http_method: "GET",
              http_path: "/release/readiness",
            }),
            risk_class: "read_only",
            tags: JSON.stringify(["release", "read_only"]),
            status: "active",
          },
        ]];
      },
    },
  },
);

assert.equal(indexedSearch.count, 1);
assert.equal(indexedSearch.tools[0].tool_key, "release_readiness");
assert.equal(indexedSearch.tools[0].description, "Full platform release readiness check.");
assert.equal(indexedSearch.tools[0].http_method, "GET");
assert.equal(indexedSearch.tools[0].http_path, "/release/readiness");
assert.equal(indexedSearch.tools[0].raw_manifest_exposed, false);

console.log("agent intelligence runtime tests passed");
