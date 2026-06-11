import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const migration = readFileSync(new URL("./migrations/277_sprint68_execution_log_runtime_evidence.sql", import.meta.url), "utf8");
const logger = readFileSync(new URL("./executionEvidenceLogger.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const token of [
  "agent_id",
  "agent_key",
  "skill_id",
  "skill_key",
  "workflow_id",
  "workflow_key",
  "workflow_binding_key",
  "app_connection_id",
  "plugin_key",
  "role_keys",
  "policy_keys",
  "agent_evidence_json",
  "skill_evidence_json",
  "app_evidence_json",
  "workflow_evidence_json",
  "role_evidence_json",
  "policy_evidence_json",
  "authorization_evidence_json",
  "runtime_evidence_json",
  "execution_evidence_status",
  "v_execution_log_runtime_evidence_readiness",
  "v_execution_log_runtime_evidence_recent",
  "execution_log_runtime_evidence_policy_v1",
]) assert.match(migration, new RegExp(token));

assert.match(migration, /CREATE OR REPLACE VIEW `v_execution_log_runtime_evidence_readiness`/);
assert.match(migration, /idx_execution_log_agent_skill/);
assert.match(runner, /277_sprint68_execution_log_runtime_evidence\.sql/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /encrypted_credentials|value_ciphertext|secret_value|token_value|private_key/i);
assert.match(logger, /BLOCKED_EVIDENCE_KEY_PATTERN/);
assert.match(logger, /runtimeEvidenceEnvelope/);
assert.match(logger, /execution_evidence_status/);

const captured = { insert: null, update: null, fullContextUpdate: null };
const pool = {
  async query(sql, params = []) {
    const text = String(sql).trim();
    if (text.startsWith("INSERT INTO execution_log")) {
      captured.insert = { sql, params };
      return [{ affectedRows: 1, insertId: 123 }];
    }
    if (text.startsWith("UPDATE execution_log") && text.includes("agent_id = ?")) {
      captured.update = { sql, params };
      return [{ affectedRows: 1, changedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_log") && text.includes("brand_name = ?")) {
      captured.fullContextUpdate = { sql, params };
      return [{ affectedRows: 1, changedRows: 1 }];
    }
    if (text.includes("FROM execution_log")) {
      return [[{ id: 123, execution_status: "success", execution_trace_id_writeback: "trace-runtime-evidence" }]];
    }
    return [[]];
  },
};

const result = await writeExecutionEvidence({
  pool,
  skipSurfaceAuthority: true,
  traceId: "trace-runtime-evidence",
  entryType: "runtime_evidence_test",
  executionClass: "test",
  sourceLayer: "test",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  roleKeys: ["tenant_admin", "operator"],
  policyKeys: ["execution_log_runtime_evidence_policy_v1", "platform_resource_authority_binding_policy_v1"],
  agentId: "agent-1",
  agentKey: "growth_agent",
  skillId: "skill-1",
  skillKey: "seo_cluster_skill",
  appKey: "wordpress_rest",
  appConnectionId: "conn-1",
  pluginKey: "tenant.plugin",
  workflowId: "workflow-1",
  workflowKey: "publish_workflow",
  workflowBindingKey: "publish_binding",
  actionKey: "wordpress.publish",
  toolKey: "wordpress_publish_tool",
  agentEvidence: { agent_id: "agent-1", system_prompt: "must_not_log" },
  skillEvidence: { skill_key: "seo_cluster_skill", capability_json: { must_not_log: true } },
  appEvidence: { app_key: "wordpress_rest", credential_ref: "must_not_log" },
  workflowEvidence: { workflow_key: "publish_workflow", n8n_webhook_url: "must_not_log" },
  roleEvidence: { role_keys: ["tenant_admin"], granted_by: "fixture" },
  policyEvidence: { policy_keys: ["execution_log_runtime_evidence_policy_v1"], secret_value: "must_not_log" },
  authorizationEvidence: { source: "authorized_access", credential_ref: "must_not_log" },
});

assert.equal(result.ok, true);
assert.ok(captured.insert, "insert should be captured");
assert.ok(captured.update, "runtime evidence update should be captured");
assert.equal((captured.insert.sql.match(/\?/g) || []).length, captured.insert.params.length);
assert.equal((captured.update.sql.match(/\?/g) || []).length, captured.update.params.length);

for (const token of [
  "agent_id = ?",
  "skill_key = ?",
  "workflow_key = ?",
  "app_connection_id = ?",
  "role_keys = ?",
  "policy_keys = ?",
  "runtime_evidence_json = ?",
  "execution_evidence_status = ?",
]) assert.match(captured.update.sql, new RegExp(token.replace(/[?]/g, "\\?")));

const updateParams = captured.update.params;
assert.ok(updateParams.includes("agent-1"));
assert.ok(updateParams.includes("growth_agent"));
assert.ok(updateParams.includes("seo_cluster_skill"));
assert.ok(updateParams.includes("wordpress_rest") === false, "app_key stays in base insert, not duplicate update param");
assert.ok(updateParams.includes("conn-1"));
assert.ok(updateParams.includes("publish_workflow"));
assert.ok(updateParams.includes("publish_binding"));
assert.ok(updateParams.includes("tenant_admin,operator"));
assert.ok(updateParams.includes("execution_log_runtime_evidence_policy_v1,platform_resource_authority_binding_policy_v1"));
assert.ok(updateParams.includes("complete"));

const runtimeEvidenceJson = updateParams.at(-3);
const runtimeEvidence = JSON.parse(runtimeEvidenceJson);
const serialized = JSON.stringify(runtimeEvidence);
assert.equal(runtimeEvidence.secrets_included, false);
assert.equal(runtimeEvidence.dimensions.tenant_id, "tenant-1");
assert.equal(runtimeEvidence.surfaces.agent_id, "agent-1");
assert.equal(runtimeEvidence.surfaces.workflow_key, "publish_workflow");
assert.doesNotMatch(serialized, /must_not_log|credential_ref|system_prompt|capability_json|n8n_webhook_url|secret_value/i);

console.log("execution log runtime evidence test passed");
