import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/204_sprint67_core_runtime_context_dimensions.sql", import.meta.url), "utf8");

const tables = [
  "audit_log",
  "telemetry_spans",
  "session_events",
  "gpt_session_turns",
  "workflow_runs",
  "step_runs",
  "intent_resolutions",
  "execution_plans",
  "platform_engine_execution_runs",
  "local_gateway_tool_call_log",
  "approval_holds",
  "sink_dispatch_log",
  "platform_graph_query_log",
  "repo_ingestion_jobs",
];
for (const table of tables) {
  assert.match(migration, new RegExp(`ALTER TABLE ${table}\\b`), `${table} should receive context dimensions`);
}

for (const token of ["workspace_id", "workspace_key", "user_id", "actor_id", "actor_type", "brand_id", "brand_key", "request_id", "session_id", "conversation_id", "correlation_id", "execution_context_json"]) {
  assert.ok(migration.includes(token), `migration should include ${token}`);
}

assert.match(migration, /platform_graph_query_log[\s\S]*resource_type/);
assert.match(migration, /platform_graph_query_log[\s\S]*resource_id/);
assert.match(migration, /customer_sessions_backfill/);
assert.match(migration, /workflow_runs_backfill/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("core runtime context dimension migration guard passed");
