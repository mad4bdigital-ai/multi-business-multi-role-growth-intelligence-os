import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/206_sprint67_platform_relationship_integrity_views.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const workflowRoutes = readFileSync(new URL("./routes/workflowOrchestrationRoutes.js", import.meta.url), "utf8");

assert.ok(migration.includes("v_platform_relationship_integrity_summary"));
assert.ok(migration.includes("v_platform_relationship_integrity_issues"));
assert.ok(migration.includes("v_platform_relationship_integrity_score"));
assert.ok(migration.includes("approval_holds.run_id -> workflow_runs/local_gateway"));
assert.ok(migration.includes("app_integration_tool_bindings.tool -> resolved tool registry"));
assert.ok(migration.includes("local_gateway_tools"));
assert.ok(migration.includes("repo_inspect"));
assert.ok(migration.includes("repo_patch_apply"));
assert.ok(migration.includes("secrets_included"));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.ok(runner.includes("206_sprint67_platform_relationship_integrity_views.sql"));

for (const token of ["workspace_id", "workspace_key", "brand_id", "brand_key", "request_id", "session_id", "conversation_id", "correlation_id", "execution_context_json"]) {
  assert.ok(workflowRoutes.includes(token), `workflow orchestration route should write ${token}`);
}
for (const table of ["workflow_runs", "approval_holds", "step_runs"]) {
  assert.ok(workflowRoutes.includes(table), `workflow orchestration routes should write ${table}`);
}
assert.doesNotMatch(workflowRoutes, /secrets_included:\s*true/);

console.log("platform relationship integrity tests passed");
