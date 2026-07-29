import {
  clampLimit,
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  freezeRecords,
  requireUniqueRow,
  toBoolean,
  unsupportedRepositoryWrite,
} from "./sqlRepositorySupport.js";

const EXECUTION_PLAN_SQL = `
  SELECT
    p.plan_id,
    p.tenant_id,
    p.workspace_id,
    p.workspace_key,
    p.user_id,
    p.actor_id,
    p.actor_type,
    p.brand_id,
    p.brand_key,
    p.resolution_id,
    p.intent_key,
    p.request_id,
    p.session_id,
    p.conversation_id,
    p.correlation_id,
    p.target_key,
    p.workflow_key,
    p.workflow_id,
    p.agent_id,
    p.route_key,
    p.service_mode,
    p.access_decision,
    p.plan_status,
    p.runtime_status,
    p.steps_json IS NOT NULL AS has_steps,
    p.preview_json IS NOT NULL AS has_preview,
    p.validation_errors IS NOT NULL AS has_validation_errors,
    p.created_at,
    p.updated_at
  FROM execution_plans p
  WHERE p.tenant_id = ?
    AND p.plan_id = ?
  ORDER BY p.updated_at DESC
  LIMIT 2
`;

function executionEventsSql(limit) {
  return `
    SELECT
      e.plan_event_id,
      e.plan_id,
      e.plan_step_id,
      e.tenant_id,
      e.event_type,
      e.from_status,
      e.to_status,
      e.actor_id,
      e.created_at
    FROM execution_plan_events e
    WHERE e.tenant_id = ?
      AND e.plan_id = ?
    ORDER BY e.created_at ASC, e.id ASC
    LIMIT ${limit}
  `;
}

function mapPlan(row) {
  if (!row) return null;
  return freezeRecord({
    planRef: row.plan_id,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id || null,
    workspaceKey: row.workspace_key || null,
    userRef: row.user_id || null,
    actorRef: row.actor_id || null,
    actorType: row.actor_type || null,
    brandRef: row.brand_id || null,
    brandKey: row.brand_key || null,
    resolutionRef: row.resolution_id || null,
    intentKey: row.intent_key || null,
    requestRef: row.request_id || null,
    sessionRef: row.session_id || null,
    conversationRef: row.conversation_id || null,
    correlationRef: row.correlation_id || null,
    targetKey: row.target_key || null,
    workflowKey: row.workflow_key || null,
    workflowRef: row.workflow_id || null,
    agentRef: row.agent_id || null,
    routeKey: row.route_key || null,
    serviceMode: row.service_mode,
    accessDecision: row.access_decision || null,
    planStatus: row.plan_status,
    runtimeStatus: row.runtime_status || null,
    hasSteps: toBoolean(row.has_steps),
    hasPreview: toBoolean(row.has_preview),
    hasValidationErrors: toBoolean(row.has_validation_errors),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapEvent(row) {
  return {
    eventRef: row.plan_event_id,
    planRef: row.plan_id,
    stepRef: row.plan_step_id || null,
    tenantRef: row.tenant_id,
    eventType: row.event_type,
    fromStatus: row.from_status || null,
    toStatus: row.to_status || null,
    actorRef: row.actor_id || null,
    createdAt: row.created_at,
  };
}

export function createExecutionLedgerRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Execution ledger" });

  async function findExecutionPlan({ tenantRef, planRef }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const plan = cleanRequired(planRef, "planRef");
    const rows = await sql.execute(EXECUTION_PLAN_SQL, [tenant, plan]);
    const row = requireUniqueRow(rows, {
      code: "execution_plan_ambiguous",
      entityName: "Execution plan readback",
      details: { tenant_ref: tenant, plan_ref: plan },
    });
    return mapPlan(row);
  }

  async function listExecutionEvents({ tenantRef, planRef, limit = 100 }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const plan = cleanRequired(planRef, "planRef");
    const boundedLimit = clampLimit(limit);
    const rows = await sql.execute(executionEventsSql(boundedLimit), [tenant, plan]);
    return freezeRecords(rows.map(mapEvent));
  }

  async function appendExecutionEvent() {
    throw unsupportedRepositoryWrite(
      "execution_ledger_write_unsupported",
      "Execution ledger writes require an approved transactional use case and idempotency contract.",
    );
  }

  return Object.freeze({ findExecutionPlan, listExecutionEvents, appendExecutionEvent });
}

export const _testingExecutionLedgerRepository = Object.freeze({
  EXECUTION_PLAN_SQL,
  executionEventsSql,
});
