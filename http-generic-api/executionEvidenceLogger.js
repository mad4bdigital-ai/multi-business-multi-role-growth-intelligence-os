import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function isoNow() {
  return new Date().toISOString();
}

function sqlDate(iso) {
  return String(iso || isoNow()).slice(0, 10);
}

function compact(value = "", max = 1000) {
  return String(value ?? "").slice(0, max);
}

function safeJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? { secrets_included: false });
  } catch {
    return JSON.stringify({ ok: false, serialization_error: "output_summary_json_failed", secrets_included: false });
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return null;
}

function pickContext(sources = [], explicit, keys = []) {
  return firstNonEmpty(
    explicit,
    ...sources.flatMap((source) => keys.map((key) => source[key]))
  );
}

function contextJson(context = {}) {
  const clean = { ...context, secrets_included: false };
  for (const key of Object.keys(clean)) {
    if (clean[key] === undefined) delete clean[key];
  }
  return safeJson(clean);
}

const BLOCKED_EVIDENCE_KEY_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json|capability_json|encrypted_credentials|webhook_url|n8n_webhook_url|system_prompt|prompt_template|manifest_json|tool_manifest_json|input_schema_json|output_schema_json)/i;

function stripSensitiveEvidence(value, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map((item) => stripSensitiveEvidence(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_EVIDENCE_KEY_PATTERN.test(key)) continue;
    const next = stripSensitiveEvidence(item, depth + 1);
    if (next !== undefined) clean[key] = next;
  }
  return clean;
}

function evidenceJson(value = {}) {
  return safeJson({ ...stripSensitiveEvidence(asObject(value)), secrets_included: false });
}

function pickEvidenceObject(contextObjects = [], explicit, keys = []) {
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) return explicit;
  for (const source of contextObjects) {
    for (const key of keys) {
      const value = source[key];
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    }
  }
  return {};
}

function compactList(value, max = 1000) {
  if (Array.isArray(value)) return compact(value.filter(Boolean).join(","), max);
  return value === null || value === undefined ? null : compact(value, max);
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

export async function writeExecutionEvidence({
  pool = getPool(),
  traceId,
  entryType,
  executionClass,
  sourceLayer,
  userInput = "",
  routeKeys = "",
  selectedWorkflows = "",
  executionMode = "runtime_evidence",
  decisionTrigger = "runtime",
  executionStatus = "success",
  outputSummary = { secrets_included: false },
  recoveryStatus = "not_required",
  routeStatus = "resolved",
  routeSource = "sql_primary",
  intakeValidationStatus = "validated",
  executionReadyStatus = "ready",
  logSource = "sql_primary",
  createdAt = null,
  endedAt = null,
  durationSeconds = null,
  recoveryNotes = null,
  failureReason = null,
  artifactJsonAssetId = null,
  targetModuleWriteback = null,
  targetWorkflowWriteback = null,
  usedLogicId = null,
  usedLogicName = null,
  resolvedLogicMode = null,
  logicAssociationStatus = "not_associated",
  usedEngineNames = "",
  usedEngineRegistryRefs = "",
  engineResolutionStatus = null,
  engineAssociationStatus = "not_associated",
  tenantId = null,
  tenantKey = null,
  workspaceId = null,
  workspaceKey = null,
  userId = null,
  actorId = null,
  actorType = null,
  brandId = null,
  brandKey = null,
  brandName = null,
  brandCoreStatus = null,
  brandCoreAssetKeys = null,
  activityId = null,
  activityType = null,
  businessActivityTypeKey = null,
  activityKey = null,
  businessTypeKey = null,
  knowledgeProfileKey = null,
  requestId = null,
  sessionId = null,
  conversationId = null,
  parentActionKey = null,
  endpointKey = null,
  toolKey = null,
  appKey = null,
  actionKey = null,
  agentId = null,
  agentKey = null,
  skillId = null,
  skillKey = null,
  workflowId = null,
  workflowKey = null,
  workflowBindingKey = null,
  appConnectionId = null,
  pluginKey = null,
  roleKeys = null,
  policyKeys = null,
  agentEvidence = null,
  skillEvidence = null,
  appEvidence = null,
  workflowEvidence = null,
  roleEvidence = null,
  policyEvidence = null,
  authorizationEvidence = null,
  runtimeEvidence = null,
  executionEvidenceStatus = null,
  connectedSystemId = null,
  credentialRefId = null,
  resourceType = null,
  resourceId = null,
  targetType = null,
  targetId = null,
  environment = process.env.NODE_ENV || "production",
  correlationId = null,
  idempotencyKey = null,
  executionContext = null,
  contextSources = [],
  skipSurfaceAuthority = false,
} = {}) {
  if (!traceId) {
    const err = new Error("traceId is required for execution evidence logging.");
    err.status = 400;
    err.code = "missing_execution_trace_id";
    throw err;
  }
  if (!entryType) {
    const err = new Error("entryType is required for execution evidence logging.");
    err.status = 400;
    err.code = "missing_execution_entry_type";
    throw err;
  }

  let surfaceAuthority = null;
  if (skipSurfaceAuthority !== true) {
    surfaceAuthority = await assertSurfaceAuthority(
      SURFACE_KEYS.EXECUTION_LOG,
      { requireExecution: true },
      { pool }
    );
  }

  const now = createdAt || isoNow();
  const end = endedAt || now;
  const outputObject = asObject(outputSummary);
  const output = Object.keys(outputObject).length
    ? { ...outputObject, secrets_included: outputObject.secrets_included === true ? true : false }
    : outputSummary;
  const contextObjects = [
    outputObject,
    ...(Array.isArray(contextSources) ? contextSources : [contextSources]).map(asObject),
  ];

  const contextDimensions = {
    tenant_id: pickContext(contextObjects, tenantId, ["tenant_id", "tenantId"]),
    tenant_key: pickContext(contextObjects, tenantKey, ["tenant_key", "tenantKey"]),
    workspace_id: pickContext(contextObjects, workspaceId, ["workspace_id", "workspaceId"]),
    workspace_key: pickContext(contextObjects, workspaceKey, ["workspace_key", "workspaceKey"]),
    user_id: pickContext(contextObjects, userId, ["user_id", "userId"]),
    actor_id: pickContext(contextObjects, actorId, ["actor_id", "actorId", "user_id", "userId"]),
    actor_type: pickContext(contextObjects, actorType, ["actor_type", "actorType"]),
    brand_id: pickContext(contextObjects, brandId, ["brand_id", "brandId"]),
    brand_key: pickContext(contextObjects, brandKey, ["brand_key", "brandKey"]),
    activity_id: pickContext(contextObjects, activityId, ["activity_id", "activityId"]),
    activity_type: pickContext(contextObjects, activityType, ["activity_type", "activityType"]),
    request_id: pickContext(contextObjects, requestId, ["request_id", "requestId"]),
    session_id: pickContext(contextObjects, sessionId, ["session_id", "sessionId"]),
    conversation_id: pickContext(contextObjects, conversationId, ["conversation_id", "conversationId"]),
    parent_action_key: pickContext(contextObjects, parentActionKey, ["parent_action_key", "parentActionKey"]),
    endpoint_key: pickContext(contextObjects, endpointKey, ["endpoint_key", "endpointKey"]),
    tool_key: pickContext(contextObjects, toolKey, ["tool_key", "toolKey"]),
    app_key: pickContext(contextObjects, appKey, ["app_key", "appKey", "plugin_key", "pluginKey"]),
    action_key: pickContext(contextObjects, actionKey, ["action_key", "actionKey"]),
    connected_system_id: pickContext(contextObjects, connectedSystemId, ["connected_system_id", "connectedSystemId", "connection_id", "connectionId"]),
    credential_ref_id: pickContext(contextObjects, credentialRefId, ["credential_ref_id", "credentialRefId", "credential_ref", "credentialRef"]),
    resource_type: pickContext(contextObjects, resourceType, ["resource_type", "resourceType"]),
    resource_id: pickContext(contextObjects, resourceId, ["resource_id", "resourceId"]),
    target_type: pickContext(contextObjects, targetType, ["target_type", "targetType"]),
    target_id: pickContext(contextObjects, targetId, ["target_id", "targetId"]),
    environment: pickContext(contextObjects, environment, ["environment", "env"]),
    correlation_id: pickContext(contextObjects, correlationId, ["correlation_id", "correlationId", "trace_id", "traceId"]) || traceId,
    idempotency_key: pickContext(contextObjects, idempotencyKey, ["idempotency_key", "idempotencyKey"]),
    agent_id: pickContext(contextObjects, agentId, ["agent_id", "agentId"]),
    agent_key: pickContext(contextObjects, agentKey, ["agent_key", "agentKey", "agent_name", "agentName"]),
    skill_id: pickContext(contextObjects, skillId, ["skill_id", "skillId"]),
    skill_key: pickContext(contextObjects, skillKey, ["skill_key", "skillKey"]),
    workflow_id: pickContext(contextObjects, workflowId, ["workflow_id", "workflowId"]),
    workflow_key: pickContext(contextObjects, workflowKey, ["workflow_key", "workflowKey", "selected_workflow", "selectedWorkflow"]),
    workflow_binding_key: pickContext(contextObjects, workflowBindingKey, ["workflow_binding_key", "workflowBindingKey", "binding_key", "bindingKey"]),
    app_connection_id: pickContext(contextObjects, appConnectionId, ["app_connection_id", "appConnectionId", "connection_id", "connectionId"]),
    plugin_key: pickContext(contextObjects, pluginKey, ["plugin_key", "pluginKey"]),
    role_keys: compactList(firstNonEmpty(roleKeys, ...contextObjects.map((source) => source.role_keys || source.roleKeys || source.role || source.user_role || source.userRole)), 1000),
    policy_keys: compactList(firstNonEmpty(policyKeys, ...contextObjects.map((source) => source.policy_keys || source.policyKeys || source.policy_key || source.policyKey)), 1000),
  };
  if (!contextDimensions.actor_type && contextDimensions.actor_id) contextDimensions.actor_type = contextDimensions.user_id ? "user" : "system";

  const evidenceObjects = {
    agent: stripSensitiveEvidence(pickEvidenceObject(contextObjects, agentEvidence, ["agent_evidence", "agentEvidence", "agent"])),
    skill: stripSensitiveEvidence(pickEvidenceObject(contextObjects, skillEvidence, ["skill_evidence", "skillEvidence", "skill"])),
    app: stripSensitiveEvidence(pickEvidenceObject(contextObjects, appEvidence, ["app_evidence", "appEvidence", "app"])),
    workflow: stripSensitiveEvidence(pickEvidenceObject(contextObjects, workflowEvidence, ["workflow_evidence", "workflowEvidence", "workflow"])),
    role: stripSensitiveEvidence(pickEvidenceObject(contextObjects, roleEvidence, ["role_evidence", "roleEvidence", "role"])),
    policy: stripSensitiveEvidence(pickEvidenceObject(contextObjects, policyEvidence, ["policy_evidence", "policyEvidence", "policy"])),
    authorization: stripSensitiveEvidence(pickEvidenceObject(contextObjects, authorizationEvidence, ["authorization_evidence", "authorizationEvidence", "authorized_access", "authorizedAccess"])),
  };
  const runtimeEvidenceEnvelope = {
    ...pickEvidenceObject(contextObjects, runtimeEvidence, ["runtime_evidence", "runtimeEvidence"]),
    dimensions: {
      tenant_id: contextDimensions.tenant_id,
      workspace_id: contextDimensions.workspace_id,
      user_id: contextDimensions.user_id,
      actor_id: contextDimensions.actor_id,
      actor_type: contextDimensions.actor_type,
      role_keys: contextDimensions.role_keys,
      policy_keys: contextDimensions.policy_keys,
    },
    surfaces: {
      agent_id: contextDimensions.agent_id,
      agent_key: contextDimensions.agent_key,
      skill_id: contextDimensions.skill_id,
      skill_key: contextDimensions.skill_key,
      app_key: contextDimensions.app_key,
      app_connection_id: contextDimensions.app_connection_id,
      plugin_key: contextDimensions.plugin_key,
      workflow_id: contextDimensions.workflow_id,
      workflow_key: contextDimensions.workflow_key,
      workflow_binding_key: contextDimensions.workflow_binding_key,
      action_key: contextDimensions.action_key,
      tool_key: contextDimensions.tool_key,
    },
    evidence: evidenceObjects,
    secrets_included: false,
  };
  const derivedExecutionEvidenceStatus = firstNonEmpty(
    executionEvidenceStatus,
    contextDimensions.tenant_id && contextDimensions.user_id && contextDimensions.policy_keys ? "complete" : "partial"
  );

  const executionContextJson = contextJson({
    ...asObject(executionContext),
    dimensions: contextDimensions,
    route_keys: routeKeys,
    selected_workflows: selectedWorkflows,
    trace_id: traceId,
    runtime_evidence: runtimeEvidenceEnvelope,
  });

  await pool.query(
    `INSERT INTO execution_log
       (run_date, start_time, end_time, duration_seconds,
        entry_type, execution_class, source_layer, user_input,
        route_keys, selected_workflows, execution_mode, decision_trigger,
        execution_status, output_summary, recovery_status, recovery_notes,
        route_status, route_source, intake_validation_status, execution_ready_status,
        failure_reason, artifact_json_asset_id, target_module_writeback,
        target_workflow_writeback, execution_trace_id_writeback,
        log_source_writeback, tenant_id, tenant_key, workspace_id, workspace_key,
        user_id, actor_id, actor_type, brand_id, brand_key,
        activity_id, activity_type, request_id, session_id, conversation_id,
        parent_action_key, endpoint_key, tool_key, app_key, action_key,
        connected_system_id, credential_ref_id, resource_type, resource_id,
        target_type, target_id, environment, correlation_id, idempotency_key,
        execution_context_json, used_logic_id, used_logic_name,
        resolved_logic_mode, logic_association_status,
        used_engine_names, used_engine_registry_refs,
        engine_resolution_status, engine_association_status,
        created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [
      sqlDate(now),
      now,
      end,
      durationSeconds === null || durationSeconds === undefined ? null : String(durationSeconds),
      compact(entryType, 255),
      compact(executionClass, 255),
      compact(sourceLayer, 255),
      compact(userInput, 1000),
      compact(routeKeys, 1000),
      compact(selectedWorkflows, 1000),
      compact(executionMode, 255),
      compact(decisionTrigger, 255),
      compact(executionStatus, 255),
      safeJson(output),
      compact(recoveryStatus, 255),
      recoveryNotes === null || recoveryNotes === undefined ? null : compact(recoveryNotes, 1000),
      compact(routeStatus, 255),
      compact(routeSource, 255),
      compact(intakeValidationStatus, 255),
      compact(executionReadyStatus, 255),
      failureReason === null || failureReason === undefined ? null : compact(failureReason, 1000),
      artifactJsonAssetId === null || artifactJsonAssetId === undefined ? null : compact(artifactJsonAssetId, 255),
      targetModuleWriteback === null || targetModuleWriteback === undefined ? null : compact(targetModuleWriteback, 255),
      targetWorkflowWriteback === null || targetWorkflowWriteback === undefined ? null : compact(targetWorkflowWriteback, 255),
      compact(traceId, 255),
      compact(logSource, 255),
      contextDimensions.tenant_id === null ? null : compact(contextDimensions.tenant_id, 64),
      contextDimensions.tenant_key === null ? null : compact(contextDimensions.tenant_key, 128),
      contextDimensions.workspace_id === null ? null : compact(contextDimensions.workspace_id, 64),
      contextDimensions.workspace_key === null ? null : compact(contextDimensions.workspace_key, 128),
      contextDimensions.user_id === null ? null : compact(contextDimensions.user_id, 64),
      contextDimensions.actor_id === null ? null : compact(contextDimensions.actor_id, 64),
      contextDimensions.actor_type === null ? null : compact(contextDimensions.actor_type, 64),
      contextDimensions.brand_id === null ? null : compact(contextDimensions.brand_id, 64),
      contextDimensions.brand_key === null ? null : compact(contextDimensions.brand_key, 128),
      contextDimensions.activity_id === null ? null : compact(contextDimensions.activity_id, 64),
      contextDimensions.activity_type === null ? null : compact(contextDimensions.activity_type, 128),
      contextDimensions.request_id === null ? null : compact(contextDimensions.request_id, 128),
      contextDimensions.session_id === null ? null : compact(contextDimensions.session_id, 128),
      contextDimensions.conversation_id === null ? null : compact(contextDimensions.conversation_id, 128),
      contextDimensions.parent_action_key === null ? null : compact(contextDimensions.parent_action_key, 191),
      contextDimensions.endpoint_key === null ? null : compact(contextDimensions.endpoint_key, 191),
      contextDimensions.tool_key === null ? null : compact(contextDimensions.tool_key, 191),
      contextDimensions.app_key === null ? null : compact(contextDimensions.app_key, 191),
      contextDimensions.action_key === null ? null : compact(contextDimensions.action_key, 191),
      contextDimensions.connected_system_id === null ? null : compact(contextDimensions.connected_system_id, 64),
      contextDimensions.credential_ref_id === null ? null : compact(contextDimensions.credential_ref_id, 191),
      contextDimensions.resource_type === null ? null : compact(contextDimensions.resource_type, 128),
      contextDimensions.resource_id === null ? null : compact(contextDimensions.resource_id, 191),
      contextDimensions.target_type === null ? null : compact(contextDimensions.target_type, 128),
      contextDimensions.target_id === null ? null : compact(contextDimensions.target_id, 191),
      contextDimensions.environment === null ? null : compact(contextDimensions.environment, 64),
      contextDimensions.correlation_id === null ? null : compact(contextDimensions.correlation_id, 191),
      contextDimensions.idempotency_key === null ? null : compact(contextDimensions.idempotency_key, 191),
      executionContextJson,
      usedLogicId === null || usedLogicId === undefined ? null : compact(usedLogicId, 255),
      usedLogicName === null || usedLogicName === undefined ? null : compact(usedLogicName, 255),
      resolvedLogicMode === null || resolvedLogicMode === undefined ? null : compact(resolvedLogicMode, 255),
      compact(logicAssociationStatus || "not_associated", 255),
      compact(usedEngineNames, 1000),
      compact(usedEngineRegistryRefs, 1000),
      engineResolutionStatus === null || engineResolutionStatus === undefined ? null : compact(engineResolutionStatus, 255),
      compact(engineAssociationStatus || "not_associated", 255),
    ]
  );

  await safeQuery(
    pool,
    `UPDATE execution_log
        SET agent_id = ?, agent_key = ?, skill_id = ?, skill_key = ?,
            workflow_id = ?, workflow_key = ?, workflow_binding_key = ?,
            app_connection_id = ?, plugin_key = ?, role_keys = ?, policy_keys = ?,
            agent_evidence_json = ?, skill_evidence_json = ?, app_evidence_json = ?,
            workflow_evidence_json = ?, role_evidence_json = ?, policy_evidence_json = ?,
            authorization_evidence_json = ?, runtime_evidence_json = ?,
            execution_evidence_status = ?
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [
      contextDimensions.agent_id === null ? null : compact(contextDimensions.agent_id, 64),
      contextDimensions.agent_key === null ? null : compact(contextDimensions.agent_key, 191),
      contextDimensions.skill_id === null ? null : compact(contextDimensions.skill_id, 64),
      contextDimensions.skill_key === null ? null : compact(contextDimensions.skill_key, 191),
      contextDimensions.workflow_id === null ? null : compact(contextDimensions.workflow_id, 191),
      contextDimensions.workflow_key === null ? null : compact(contextDimensions.workflow_key, 191),
      contextDimensions.workflow_binding_key === null ? null : compact(contextDimensions.workflow_binding_key, 191),
      contextDimensions.app_connection_id === null ? null : compact(contextDimensions.app_connection_id, 64),
      contextDimensions.plugin_key === null ? null : compact(contextDimensions.plugin_key, 191),
      contextDimensions.role_keys === null ? null : compact(contextDimensions.role_keys, 1000),
      contextDimensions.policy_keys === null ? null : compact(contextDimensions.policy_keys, 1000),
      evidenceJson(evidenceObjects.agent),
      evidenceJson(evidenceObjects.skill),
      evidenceJson(evidenceObjects.app),
      evidenceJson(evidenceObjects.workflow),
      evidenceJson(evidenceObjects.role),
      evidenceJson(evidenceObjects.policy),
      evidenceJson(evidenceObjects.authorization),
      evidenceJson(runtimeEvidenceEnvelope),
      compact(derivedExecutionEvidenceStatus || "partial", 64),
      traceId,
    ]
  );

  const rows = await safeQuery(
    pool,
    `SELECT id, execution_status, execution_trace_id_writeback
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );

  return {
    ok: Boolean(rows[0]),
    row: rows[0] || null,
    trace_id: traceId,
    surface_authority: surfaceAuthority ? {
      ok: surfaceAuthority.ok,
      resolved_surface_key: surfaceAuthority.resolved_surface_key,
      classification: surfaceAuthority.classification,
      code: surfaceAuthority.code,
    } : { skipped: true },
    secrets_included: false,
  };
}
