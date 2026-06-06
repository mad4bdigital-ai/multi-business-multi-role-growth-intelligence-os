import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration207 = readFileSync(new URL("./migrations/207_sprint67_platform_relationship_integrity_views.sql", import.meta.url), "utf8");
const migration210 = readFileSync(new URL("./migrations/210_sprint67_approval_hold_tenant_ssh_relationship_alignment.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const workflowRoutes = readFileSync(new URL("./routes/workflowOrchestrationRoutes.js", import.meta.url), "utf8");

assert.ok(migration207.includes("v_platform_relationship_integrity_summary"));
assert.ok(migration207.includes("v_platform_relationship_integrity_issues"));
assert.ok(migration207.includes("v_platform_relationship_integrity_score"));
assert.ok(migration207.includes("approval_holds.run_id -> workflow_runs/local_gateway"));
assert.ok(migration207.includes("app_integration_tool_bindings.tool -> resolved tool registry"));
assert.ok(migration207.includes("local_gateway_tools"));
assert.ok(migration207.includes("repo_inspect"));
assert.ok(migration207.includes("repo_patch_apply"));
assert.ok(migration207.includes("secrets_included"));
assert.doesNotMatch(migration207, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.ok(runner.includes("207_sprint67_platform_relationship_integrity_views.sql"));

assert.ok(migration210.includes("v_approval_hold_parent_resolution"));
assert.ok(migration210.includes("tenant_ssh_cli_approval_requests"));
assert.ok(migration210.includes("approval_holds.run_id -> workflow_runs/local_gateway/tenant_ssh_cli_approval_requests"));
assert.ok(migration210.includes("resolved_parent_reference"));
assert.ok(migration210.includes("tenant_infrastructure_routes"));
assert.ok(migration210.includes("secrets_included"));
assert.doesNotMatch(migration210, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.ok(runner.includes("210_sprint67_approval_hold_tenant_ssh_relationship_alignment.sql"));

for (const token of ["workspace_id", "workspace_key", "brand_id", "brand_key", "request_id", "session_id", "conversation_id", "correlation_id", "execution_context_json"]) {
  assert.ok(workflowRoutes.includes(token), `workflow orchestration route should write ${token}`);
}
for (const table of ["workflow_runs", "approval_holds", "step_runs"]) {
  assert.ok(workflowRoutes.includes(table), `workflow orchestration routes should write ${table}`);
}
assert.doesNotMatch(workflowRoutes, /secrets_included:\s*true/);

console.log("platform relationship integrity tests passed");
