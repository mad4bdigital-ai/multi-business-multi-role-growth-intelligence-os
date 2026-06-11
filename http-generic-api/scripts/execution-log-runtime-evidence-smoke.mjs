#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

const BLOCKED_PATTERN = /\"(credential_ref|value_ciphertext|secret_value|token_value|password|private_key|config_json|capability_json|encrypted_credentials|webhook_url|n8n_webhook_url|system_prompt|prompt_template|manifest_json|tool_manifest_json|input_schema_json|output_schema_json)\"\s*:|must_not_log/i;

async function readEvidenceRow(pool, traceId) {
  const [rows] = await pool.query(
    `SELECT id, execution_trace_id_writeback, execution_status, execution_evidence_status,
            tenant_id, workspace_id, user_id, actor_id, actor_type,
            role_keys, policy_keys,
            parent_action_key, endpoint_key, tool_key, action_key,
            app_key, app_connection_id, plugin_key,
            agent_id, agent_key, skill_id, skill_key,
            workflow_id, workflow_key, workflow_binding_key,
            JSON_VALID(COALESCE(agent_evidence_json, '{}')) AS agent_evidence_json_valid,
            JSON_VALID(COALESCE(skill_evidence_json, '{}')) AS skill_evidence_json_valid,
            JSON_VALID(COALESCE(app_evidence_json, '{}')) AS app_evidence_json_valid,
            JSON_VALID(COALESCE(workflow_evidence_json, '{}')) AS workflow_evidence_json_valid,
            JSON_VALID(COALESCE(role_evidence_json, '{}')) AS role_evidence_json_valid,
            JSON_VALID(COALESCE(policy_evidence_json, '{}')) AS policy_evidence_json_valid,
            JSON_VALID(COALESCE(authorization_evidence_json, '{}')) AS authorization_evidence_json_valid,
            JSON_VALID(COALESCE(runtime_evidence_json, '{}')) AS runtime_evidence_json_valid,
            CONCAT_WS('', agent_evidence_json, skill_evidence_json, app_evidence_json, workflow_evidence_json, role_evidence_json, policy_evidence_json, authorization_evidence_json, runtime_evidence_json) AS evidence_text
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );
  return rows[0] || null;
}

async function main() {
  const pool = getPool();
  const traceId = `execution_log_runtime_evidence_smoke:${randomUUID()}`;
  const tenantId = "00000000-0000-4000-a000-000000000099";
  const workspaceId = "00000000-0000-4000-a000-000000000095";
  const userId = "activation_smoke_user";

  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "execution_log_runtime_evidence_smoke",
    executionClass: "governance_smoke",
    sourceLayer: "execution_log_runtime_evidence_smoke",
    userInput: "runtime evidence smoke without provider dispatch",
    routeKeys: "execution_log_runtime_evidence_smoke",
    selectedWorkflows: "activation_smoke_workflow",
    executionMode: "runtime_evidence_smoke",
    decisionTrigger: "governed_smoke",
    executionStatus: "success",
    outputSummary: {
      smoke: "execution_log_runtime_evidence",
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      role_keys: ["tenant_admin", "operator"],
      policy_keys: ["execution_log_runtime_evidence_policy_v1", "platform_resource_authority_binding_policy_v1"],
      app_key: "activation_smoke_app",
      action_key: "activation_smoke_app.execute",
      secrets_included: false,
    },
    tenantId,
    workspaceId,
    userId,
    actorId: userId,
    actorType: "user",
    parentActionKey: "wordpress_api",
    endpointKey: "wordpress_publish",
    toolKey: "wordpress_publish_tool",
    appKey: "activation_smoke_app",
    actionKey: "activation_smoke_app.execute",
    appConnectionId: "00000000-0000-4000-a000-000000000091",
    pluginKey: "activation.smoke.plugin",
    agentId: "00000000-0000-4000-a000-000000000094",
    agentKey: "activation_smoke_agent",
    skillId: "00000000-0000-4000-a000-000000000093",
    skillKey: "activation_smoke_skill",
    workflowId: "00000000-0000-4000-a000-000000000089",
    workflowKey: "activation_smoke_workflow",
    workflowBindingKey: "activation_smoke_workflow_binding",
    roleKeys: ["tenant_admin", "operator"],
    policyKeys: ["execution_log_runtime_evidence_policy_v1", "platform_resource_authority_binding_policy_v1"],
    resourceType: "diagnostic_smoke",
    resourceId: "execution_log_runtime_evidence",
    targetType: "execution_log",
    targetId: "runtime_evidence_smoke",
    correlationId: traceId,
    agentEvidence: { agent_id: "00000000-0000-4000-a000-000000000094", agent_key: "activation_smoke_agent", system_prompt: "must_not_log" },
    skillEvidence: { skill_id: "00000000-0000-4000-a000-000000000093", skill_key: "activation_smoke_skill", capability_json: { probe: "must_not_log" } },
    appEvidence: { app_key: "activation_smoke_app", app_connection_id: "00000000-0000-4000-a000-000000000091", credential_ref: "must_not_log" },
    workflowEvidence: { workflow_key: "activation_smoke_workflow", workflow_binding_key: "activation_smoke_workflow_binding", n8n_webhook_url: "must_not_log" },
    roleEvidence: { role_keys: ["tenant_admin", "operator"], assignment_source: "activation_smoke_fixture" },
    policyEvidence: { policy_keys: ["execution_log_runtime_evidence_policy_v1", "platform_resource_authority_binding_policy_v1"], secret_value: "must_not_log" },
    authorizationEvidence: { source: "activation_dynamic_authorization_envelope", tenant_id: tenantId, credential_ref: "must_not_log" },
  });

  const row = await readEvidenceRow(pool, traceId);
  const readinessRows = await pool.query(`SELECT * FROM v_execution_log_runtime_evidence_readiness LIMIT 1`);
  const readiness = readinessRows?.[0]?.[0] || null;
  const evidenceText = String(row?.evidence_text || "");
  const blockedFieldLeakDetected = BLOCKED_PATTERN.test(evidenceText);

  const jsonValidityOk = row
    && Number(row.agent_evidence_json_valid) === 1
    && Number(row.skill_evidence_json_valid) === 1
    && Number(row.app_evidence_json_valid) === 1
    && Number(row.workflow_evidence_json_valid) === 1
    && Number(row.role_evidence_json_valid) === 1
    && Number(row.policy_evidence_json_valid) === 1
    && Number(row.authorization_evidence_json_valid) === 1
    && Number(row.runtime_evidence_json_valid) === 1;

  const ok = Boolean(row)
    && row.execution_evidence_status === "complete"
    && row.tenant_id === tenantId
    && row.workspace_id === workspaceId
    && row.user_id === userId
    && row.role_keys === "tenant_admin,operator"
    && String(row.policy_keys || "").includes("execution_log_runtime_evidence_policy_v1")
    && row.agent_key === "activation_smoke_agent"
    && row.skill_key === "activation_smoke_skill"
    && row.app_key === "activation_smoke_app"
    && row.app_connection_id === "00000000-0000-4000-a000-000000000091"
    && row.plugin_key === "activation.smoke.plugin"
    && row.workflow_key === "activation_smoke_workflow"
    && row.workflow_binding_key === "activation_smoke_workflow_binding"
    && jsonValidityOk
    && blockedFieldLeakDetected === false
    && readiness?.readiness_status === "pass";

  console.log(JSON.stringify({
    ok,
    smoke: "execution_log_runtime_evidence_smoke",
    trace_id: traceId,
    row_id: row?.id || null,
    execution_evidence_status: row?.execution_evidence_status || null,
    tenant_id: row?.tenant_id || null,
    workspace_id: row?.workspace_id || null,
    user_id: row?.user_id || null,
    role_keys: row?.role_keys || null,
    policy_keys: row?.policy_keys || null,
    agent_key: row?.agent_key || null,
    skill_key: row?.skill_key || null,
    app_key: row?.app_key || null,
    app_connection_id: row?.app_connection_id || null,
    plugin_key: row?.plugin_key || null,
    workflow_key: row?.workflow_key || null,
    workflow_binding_key: row?.workflow_binding_key || null,
    json_validity_ok: jsonValidityOk,
    blocked_field_leak_detected: blockedFieldLeakDetected,
    readiness_status: readiness?.readiness_status || null,
    external_provider_called: false,
    secrets_included: false,
  }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "execution_log_runtime_evidence_smoke_failed", message: error.message }, external_provider_called: false, secrets_included: false }, null, 2));
  process.exit(1);
});
