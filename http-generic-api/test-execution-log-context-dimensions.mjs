import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const migration = readFileSync(new URL("./migrations/203_sprint67_execution_log_context_dimensions.sql", import.meta.url), "utf8");

for (const token of [
  "tenant_id", "tenant_key", "workspace_id", "workspace_key", "user_id", "actor_id", "actor_type",
  "brand_id", "brand_key", "activity_id", "activity_type", "request_id", "session_id", "conversation_id",
  "parent_action_key", "endpoint_key", "tool_key", "app_key", "action_key", "connected_system_id",
  "credential_ref_id", "resource_type", "resource_id", "target_type", "target_id", "environment",
  "correlation_id", "idempotency_key", "execution_context_json",
]) {
  assert.ok(
    migration.includes(`ADD COLUMN IF NOT EXISTS ${token}`) || migration.includes(`ADD COLUMN IF NOT EXISTS \`${token}\``),
    `migration should add ${token}`
  );
}
assert.match(migration, /idx_execution_log_tenant_created/);
assert.match(migration, /idx_execution_log_action_created/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

let inserted = null;
const pool = {
  async query(sql, params = []) {
    if (String(sql).startsWith("INSERT INTO execution_log")) {
      inserted = { sql, params };
      return [{ affectedRows: 1, insertId: 99 }];
    }
    if (String(sql).includes("FROM execution_log")) {
      return [[{ id: 99, execution_status: "success", execution_trace_id_writeback: "trace-context-test" }]];
    }
    return [[]];
  },
};

const result = await writeExecutionEvidence({
  pool,
  skipSurfaceAuthority: true,
  traceId: "trace-context-test",
  entryType: "context_dimension_test",
  executionClass: "test",
  sourceLayer: "test",
  outputSummary: {
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    brand_id: "brand-1",
    brand_key: "brand_key_1",
    app_key: "n8n",
    action_key: "execute_workflow",
    resource_type: "workflow",
    resource_id: "wf-1",
    request_id: "request-1",
    session_id: "session-1",
    secrets_included: false,
  },
});

assert.equal(result.ok, true);
assert.ok(inserted, "execution_log insert should have been captured");
const placeholderCount = (inserted.sql.match(/\?/g) || []).length;
assert.equal(inserted.params.length, placeholderCount, "placeholder count must match param count");
for (const column of ["tenant_id", "workspace_id", "user_id", "brand_id", "brand_key", "app_key", "action_key", "resource_type", "resource_id", "execution_context_json"]) {
  assert.match(inserted.sql, new RegExp(`\\b${column}\\b`));
}
assert.ok(inserted.params.includes("tenant-1"));
assert.ok(inserted.params.includes("workspace-1"));
assert.ok(inserted.params.includes("user-1"));
assert.ok(inserted.params.includes("brand-1"));
assert.ok(inserted.params.includes("n8n"));
assert.ok(inserted.params.includes("execute_workflow"));
assert.ok(inserted.params.includes("trace-context-test"));

console.log("execution log context dimension test passed");
