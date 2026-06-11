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
            brand_id, brand_key, brand_name, brand_core_status, brand_core_asset_keys,
            activity_id, activity_type, business_activity_type_key, activity_key, business_type_key, knowledge_profile_key,
            parent_action_key, endpoint_key, tool_key, action_key,
            app_key, app_connection_id, plugin_key,
            agent_id, agent_key, skill_id, skill_key,
            workflow_id, workflow_key, workflow_binding_key,
            connected_system_id, installation_id, permission_grant_id, permission_key, connector_family, provider_family,
            resource_authority_binding_id, budget_authority_id,
            engine_key, engine_policy_key, model_key, model_provider_key, model_run_id, logic_key, logic_pack_key,
            JSON_VALID(COALESCE(agent_evidence_json, '{}')) AS agent_evidence_json_valid,
            JSON_VALID(COALESCE(skill_evidence_json, '{}')) AS skill_evidence_json_valid,
            JSON_VALID(COALESCE(app_evidence_json, '{}')) AS app_evidence_json_valid,
            JSON_VALID(COALESCE(workflow_evidence_json, '{}')) AS workflow_evidence_json_valid,
            JSON_VALID(COALESCE(role_evidence_json, '{}')) AS role_evidence_json_valid,
            JSON_VALID(COALESCE(policy_evidence_json, '{}')) AS policy_evidence_json_valid,
            JSON_VALID(COALESCE(authorization_evidence_json, '{}')) AS authorization_evidence_json_valid,
            JSON_VALID(COALESCE(runtime_evidence_json, '{}')) AS runtime_evidence_json_valid,
            JSON_VALID(COALESCE(brand_evidence_json, '{}')) AS brand_evidence_json_valid,
            JSON_VALID(COALESCE(business_activity_evidence_json, '{}')) AS business_activity_evidence_json_valid,
            JSON_VALID(COALESCE(business_type_evidence_json, '{}')) AS business_type_evidence_json_valid,
            JSON_VALID(COALESCE(connected_system_evidence_json, '{}')) AS connected_system_evidence_json_valid,
            JSON_VALID(COALESCE(permission_evidence_json, '{}')) AS permission_evidence_json_valid,
            JSON_VALID(COALESCE(resource_authority_evidence_json, '{}')) AS resource_authority_evidence_json_valid,
            JSON_VALID(COALESCE(budget_authority_evidence_json, '{}')) AS budget_authority_evidence_json_valid,
            JSON_VALID(COALESCE(engine_evidence_json, '{}')) AS engine_evidence_json_valid,
            JSON_VALID(COALESCE(model_evidence_json, '{}')) AS model_evidence_json_valid,
            JSON_VALID(COALESCE(logic_evidence_json, '{}')) AS logic_evidence_json_valid,
            JSON_VALID(COALESCE(knowledge_evidence_json, '{}')) AS knowledge_evidence_json_valid,
            CONCAT_WS('', agent_evidence_json, skill_evidence_json, app_evidence_json, workflow_evidence_json, role_evidence_json, policy_evidence_json, authorization_evidence_json, runtime_evidence_json,
              brand_evidence_json, business_activity_evidence_json, business_type_evidence_json, connected_system_evidence_json, permission_evidence_json, resource_authority_evidence_json, budget_authority_evidence_json, engine_evidence_json, model_evidence_json, logic_evidence_json, knowledge_evidence_json) AS evidence_text
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );
  return rows[0] || null;
}

function one(row, key) {
  return row?.[key] === null || row?.[key] === undefined ? null : String(row[key]);
}

async function main() {
  const pool = getPool();
  const traceId = `execution_log_runtime_evidence_smoke:${randomUUID()}`;
  const tenantId = "00000000-0000-4000-a000-000000000099";
  const workspaceId = "00000000-0000-4000-a000-000000000095";
  const userId = "activation_smoke_user";
  const policyKeys = [
    "execution_log_runtime_evidence_policy_v1",
    "execution_log_full_context_evidence_policy_v1",
    "platform_resource_authority_binding_policy_v1",
  ];

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
      smoke: "execution_log_full_context_evidence",
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      brand_key: "activation_smoke_brand",
      business_activity_type_key: "activation_smoke_activity",
      business_type_key: "activation_smoke_business_type",
      knowledge_profile_key: "activation_smoke_profile",
      role_keys: ["tenant_admin", "operator"],
      policy_keys: policyKeys,
      app_key: "activation_smoke_app",
      action_key: "activation_smoke_app.execute",
      secrets_included: false,
    },
    tenantId,
    workspaceId,
    userId,
    actorId: userId,
    actorType: "user",
    brandId: "activation_smoke_brand_id",
    brandKey: "activation_smoke_brand",
    brandName: "Activation Smoke Brand",
    brandCoreStatus: "ready",
    brandCoreAssetKeys: ["activation_smoke_brand_core"],
    activityId: "activation_smoke_activity_id",
    activityType: "activation_smoke_activity",
    businessActivityTypeKey: "activation_smoke_activity",
    activityKey: "activation_smoke_activity_key",
    businessTypeKey: "activation_smoke_business_type",
    knowledgeProfileKey: "activation_smoke_profile",
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
    connectedSystemId: "00000000-0000-4000-a000-000000000096",
    installationId: "00000000-0000-4000-a000-000000000097",
    permissionGrantId: "00000000-0000-4000-a000-000000000098",
    permissionKey: "wordpress_api",
    connectorFamily: "http_generic_api_connector",
    providerFamily: "wordpress",
    resourceAuthorityBindingId: "activation_smoke_resource_authority",
    budgetAuthorityId: "activation_smoke_budget_authority",
    engineKey: "activation_smoke_engine",
    enginePolicyKey: "activation_smoke_engine_policy",
    modelKey: "openai/gpt-4o-mini",
    modelProviderKey: "openrouter",
    modelRunId: "activation_smoke_model_run",
    logicKey: "activation_smoke_logic",
    logicPackKey: "activation_smoke_logic_pack",
    roleKeys: ["tenant_admin", "operator"],
    policyKeys,
    resourceType: "diagnostic_smoke",
    resourceId: "execution_log_full_context_evidence",
    targetType: "execution_log",
    targetId: "runtime_evidence_smoke",
    correlationId: traceId,
    agentEvidence: { agent_id: "00000000-0000-4000-a000-000000000094", agent_key: "activation_smoke_agent", system_prompt: "must_not_log" },
    skillEvidence: { skill_id: "00000000-0000-4000-a000-000000000093", skill_key: "activation_smoke_skill", capability_json: { probe: "must_not_log" } },
    appEvidence: { app_key: "activation_smoke_app", app_connection_id: "00000000-0000-4000-a000-000000000091", credential_ref: "must_not_log" },
    workflowEvidence: { workflow_key: "activation_smoke_workflow", workflow_binding_key: "activation_smoke_workflow_binding", n8n_webhook_url: "must_not_log" },
    roleEvidence: { role_keys: ["tenant_admin", "operator"], assignment_source: "activation_smoke_fixture" },
    policyEvidence: { policy_keys: policyKeys, secret_value: "must_not_log" },
    authorizationEvidence: { source: "activation_dynamic_authorization_envelope", tenant_id: tenantId, credential_ref: "must_not_log" },
    brandEvidence: { brand_key: "activation_smoke_brand", brand_core_status: "ready", brand_core_asset_keys: ["activation_smoke_brand_core"], application_password: "must_not_log" },
    businessActivityEvidence: { business_activity_type_key: "activation_smoke_activity", activity_key: "activation_smoke_activity_key", brand_core_required: true },
    businessTypeEvidence: { business_type_key: "activation_smoke_business_type", knowledge_profile_key: "activation_smoke_profile" },
    connectedSystemEvidence: { connected_system_id: "00000000-0000-4000-a000-000000000096", connector_family: "http_generic_api_connector", credential_ref: "must_not_log" },
    permissionEvidence: { permission_grant_id: "00000000-0000-4000-a000-000000000098", permission_key: "wordpress_api", granted: true },
    resourceAuthorityEvidence: { binding_id: "activation_smoke_resource_authority", authority_source: "fixture", credential_ref: "must_not_log" },
    budgetAuthorityEvidence: { authority_id: "activation_smoke_budget_authority", meter_key: "activation_smoke_meter", max_units: 1 },
    engineEvidence: { engine_key: "activation_smoke_engine", policy_key: "activation_smoke_engine_policy" },
    modelEvidence: { model_key: "openai/gpt-4o-mini", provider_key: "openrouter", model_run_id: "activation_smoke_model_run", prompt_cache_json: { probe: "must_not_log" } },
    logicEvidence: { logic_key: "activation_smoke_logic", logic_pack_key: "activation_smoke_logic_pack", body_json: { probe: "must_not_log" } },
    knowledgeEvidence: { knowledge_profile_key: "activation_smoke_profile", source: "business_activity_resolution" },
  });

  const row = await readEvidenceRow(pool, traceId);
  const [runtimeReadinessRows] = await pool.query(`SELECT * FROM v_execution_log_runtime_evidence_readiness LIMIT 1`);
  const [fullReadinessRows] = await pool.query(`SELECT * FROM v_execution_log_full_context_evidence_readiness LIMIT 1`);
  const runtimeReadiness = runtimeReadinessRows?.[0] || null;
  const fullReadiness = fullReadinessRows?.[0] || null;
  const evidenceText = String(row?.evidence_text || "");
  const blockedFieldLeakDetected = BLOCKED_PATTERN.test(evidenceText);

  const jsonValidityKeys = [
    "agent_evidence_json_valid",
    "skill_evidence_json_valid",
    "app_evidence_json_valid",
    "workflow_evidence_json_valid",
    "role_evidence_json_valid",
    "policy_evidence_json_valid",
    "authorization_evidence_json_valid",
    "runtime_evidence_json_valid",
    "brand_evidence_json_valid",
    "business_activity_evidence_json_valid",
    "business_type_evidence_json_valid",
    "connected_system_evidence_json_valid",
    "permission_evidence_json_valid",
    "resource_authority_evidence_json_valid",
    "budget_authority_evidence_json_valid",
    "engine_evidence_json_valid",
    "model_evidence_json_valid",
    "logic_evidence_json_valid",
    "knowledge_evidence_json_valid",
  ];
  const jsonValidityOk = Boolean(row) && jsonValidityKeys.every((key) => Number(row[key]) === 1);

  const ok = Boolean(row)
    && row.execution_evidence_status === "complete"
    && row.tenant_id === tenantId
    && row.workspace_id === workspaceId
    && row.user_id === userId
    && row.role_keys === "tenant_admin,operator"
    && String(row.policy_keys || "").includes("execution_log_full_context_evidence_policy_v1")
    && row.agent_key === "activation_smoke_agent"
    && row.skill_key === "activation_smoke_skill"
    && row.app_key === "activation_smoke_app"
    && row.app_connection_id === "00000000-0000-4000-a000-000000000091"
    && row.plugin_key === "activation.smoke.plugin"
    && row.workflow_key === "activation_smoke_workflow"
    && row.workflow_binding_key === "activation_smoke_workflow_binding"
    && row.brand_key === "activation_smoke_brand"
    && row.brand_core_status === "ready"
    && row.business_activity_type_key === "activation_smoke_activity"
    && row.business_type_key === "activation_smoke_business_type"
    && row.knowledge_profile_key === "activation_smoke_profile"
    && row.connected_system_id === "00000000-0000-4000-a000-000000000096"
    && row.permission_key === "wordpress_api"
    && row.connector_family === "http_generic_api_connector"
    && row.provider_family === "wordpress"
    && row.resource_authority_binding_id === "activation_smoke_resource_authority"
    && row.budget_authority_id === "activation_smoke_budget_authority"
    && row.engine_key === "activation_smoke_engine"
    && row.model_key === "openai/gpt-4o-mini"
    && row.logic_key === "activation_smoke_logic"
    && jsonValidityOk
    && blockedFieldLeakDetected === false
    && runtimeReadiness?.readiness_status === "pass"
    && fullReadiness?.readiness_status === "pass";

  console.log(JSON.stringify({
    ok,
    smoke: "execution_log_full_context_evidence_smoke",
    trace_id: traceId,
    row_id: row?.id || null,
    execution_evidence_status: row?.execution_evidence_status || null,
    tenant_id: row?.tenant_id || null,
    workspace_id: row?.workspace_id || null,
    user_id: row?.user_id || null,
    role_keys: row?.role_keys || null,
    policy_keys: row?.policy_keys || null,
    brand_key: row?.brand_key || null,
    brand_core_status: row?.brand_core_status || null,
    business_activity_type_key: row?.business_activity_type_key || null,
    business_type_key: row?.business_type_key || null,
    knowledge_profile_key: row?.knowledge_profile_key || null,
    connected_system_id: row?.connected_system_id || null,
    permission_key: row?.permission_key || null,
    connector_family: row?.connector_family || null,
    provider_family: row?.provider_family || null,
    resource_authority_binding_id: row?.resource_authority_binding_id || null,
    budget_authority_id: row?.budget_authority_id || null,
    engine_key: row?.engine_key || null,
    model_key: row?.model_key || null,
    logic_key: row?.logic_key || null,
    agent_key: row?.agent_key || null,
    skill_key: row?.skill_key || null,
    app_key: row?.app_key || null,
    app_connection_id: row?.app_connection_id || null,
    plugin_key: row?.plugin_key || null,
    workflow_key: row?.workflow_key || null,
    workflow_binding_key: row?.workflow_binding_key || null,
    json_validity_ok: jsonValidityOk,
    blocked_field_leak_detected: blockedFieldLeakDetected,
    runtime_readiness_status: runtimeReadiness?.readiness_status || null,
    full_context_readiness_status: fullReadiness?.readiness_status || null,
    external_provider_called: false,
    secrets_included: false,
  }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "execution_log_full_context_evidence_smoke_failed", message: error.message }, external_provider_called: false, secrets_included: false }, null, 2));
  process.exit(1);
});
