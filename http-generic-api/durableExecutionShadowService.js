import { createHash } from "node:crypto";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const TERMINAL_STATES = new Set(["completed", "failed_terminal", "cancelled"]);

const TRANSITIONS = new Map([
  ["requested", new Set(["context_loading", "preflight", "cancelled"])],
  ["context_loading", new Set(["preflight", "failed_recoverable", "failed_terminal", "cancel_requested"])],
  ["preflight", new Set(["awaiting_approval", "ready", "failed_recoverable", "failed_terminal", "cancel_requested"])],
  ["awaiting_approval", new Set(["ready", "failed_terminal", "cancel_requested"])],
  ["ready", new Set(["executing", "cancel_requested"])],
  ["executing", new Set(["reconciling", "verifying", "awaiting_approval", "failed_recoverable", "failed_terminal", "cancel_requested"])],
  ["reconciling", new Set(["verifying", "completed", "failed_recoverable", "failed_terminal", "cancel_requested"])],
  ["verifying", new Set(["completed", "failed_recoverable", "failed_terminal", "cancel_requested"])],
  ["failed_recoverable", new Set(["ready", "executing", "failed_terminal", "cancel_requested"])],
  ["cancel_requested", new Set(["cancelled", "compensation_required"])],
  ["compensation_required", new Set(["compensating"])],
  ["compensating", new Set(["cancelled", "failed_terminal"])],
]);

function operationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function principalClass(auth = {}) {
  const mode = String(auth.mode || auth.caller_type || "").toLowerCase();
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) return "admin";
  if (mode === "user_jwt" && auth.user_id && auth.tenant_id) return "tenant";
  return null;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase();
}

export function deriveDurableOperationState(plan = {}, steps = []) {
  const stepStatuses = steps.map((step) => normalizedStatus(step.status));
  const rawPlanStatus = normalizedStatus(plan.runtime_status || plan.plan_status || "draft");

  if (rawPlanStatus === "cancelled") return "cancelled";
  if (rawPlanStatus === "failed") return "failed_terminal";
  if (stepStatuses.some((status) => status === "awaiting_approval") || rawPlanStatus === "awaiting_approval") return "awaiting_approval";
  if (stepStatuses.some((status) => status === "verifying")) return "verifying";
  if (stepStatuses.some((status) => ["claimed", "running"].includes(status)) || rawPlanStatus === "executing") return "executing";
  if (stepStatuses.some((status) => ["blocked", "retrying"].includes(status)) || ["paused", "blocked"].includes(rawPlanStatus)) return "failed_recoverable";
  if (steps.length > 0 && steps.every((step) => ["completed", "skipped", "cancelled"].includes(normalizedStatus(step.status)))) return "completed";
  if (rawPlanStatus === "completed") return "completed";
  if (stepStatuses.some((status) => status === "ready") || rawPlanStatus === "approved") return "ready";
  if (rawPlanStatus === "draft") return "requested";
  if (rawPlanStatus === "validated") return "preflight";
  return "context_loading";
}

export function isAllowedDurableTransition(fromState, toState) {
  const from = normalizedStatus(fromState);
  const to = normalizedStatus(toState);
  if (!from || !to) return false;
  if (from === to) return true;
  if (TERMINAL_STATES.has(from)) return false;
  return TRANSITIONS.get(from)?.has(to) === true;
}

function deriveBlockingGaps(plan, steps) {
  const gaps = [];
  if (String(plan.access_decision || "").toUpperCase() === "DENY") {
    gaps.push({ code: "ACCESS_DENIED", reason: "The persisted plan access decision denies execution." });
  }
  for (const step of steps) {
    const status = normalizedStatus(step.status);
    if (status === "awaiting_approval") {
      gaps.push({ code: "HUMAN_APPROVAL_REQUIRED", plan_step_id: step.plan_step_id, step_key: step.step_key });
    } else if (status === "blocked") {
      gaps.push({ code: "STEP_BLOCKED", plan_step_id: step.plan_step_id, step_key: step.step_key });
    } else if (status === "failed") {
      gaps.push({ code: "STEP_FAILED", plan_step_id: step.plan_step_id, step_key: step.step_key });
    } else if (status === "retrying") {
      gaps.push({ code: "STEP_RETRY_PENDING", plan_step_id: step.plan_step_id, step_key: step.step_key });
    }
  }
  if (steps.length === 0 && !["draft", "completed", "cancelled"].includes(normalizedStatus(plan.plan_status))) {
    gaps.push({ code: "PLAN_STEPS_MISSING", reason: "The execution plan has no compiled durable steps." });
  }
  return gaps;
}

function nextActionForState(state, blockingGaps) {
  const firstBlocker = blockingGaps[0]?.code || null;
  const actions = {
    requested: ["validate_plan", "PLAN_VALIDATION_REQUIRED"],
    context_loading: ["read_operation_status", "CONTEXT_LOADING"],
    preflight: ["compile_or_validate_plan", "PREFLIGHT_REQUIRED"],
    awaiting_approval: ["provide_approval", firstBlocker || "HUMAN_APPROVAL_REQUIRED"],
    ready: ["dispatch_next_step", "READY_FOR_GOVERNED_DISPATCH"],
    executing: ["read_operation_status", "EXECUTION_IN_PROGRESS"],
    reconciling: ["read_operation_status", "RECONCILIATION_IN_PROGRESS"],
    verifying: ["read_operation_status", "VERIFICATION_IN_PROGRESS"],
    completed: ["none", "OPERATION_COMPLETED"],
    failed_recoverable: ["resume_operation", firstBlocker || "RECOVERABLE_FAILURE"],
    failed_terminal: ["start_new_operation", firstBlocker || "TERMINAL_FAILURE"],
    cancel_requested: ["read_operation_status", "CANCELLATION_IN_PROGRESS"],
    cancelled: ["none", "OPERATION_CANCELLED"],
    compensation_required: ["approve_compensation", "COMPENSATION_REQUIRED"],
    compensating: ["read_operation_status", "COMPENSATION_IN_PROGRESS"],
  };
  const [action, reasonCode] = actions[state] || ["read_operation_status", "STATE_UNKNOWN"];
  return { action, reason_code: reasonCode, required_input: action === "provide_approval" ? "approval_decision" : null };
}

function projectStep(step) {
  return {
    plan_step_id: step.plan_step_id,
    step_order: Number(step.step_order || 0),
    step_key: compact(step.step_key, 191),
    step_type: compact(step.step_type, 64),
    status: normalizedStatus(step.status),
    attempt_count: Number(step.attempt_count || 0),
    max_attempts: Number(step.max_attempts || 0),
    idempotency_key: compact(step.idempotency_key, 191),
    claimed_at: step.claimed_at || null,
    started_at: step.started_at || null,
    completed_at: step.completed_at || null,
  };
}

function projectEvent(event) {
  return {
    plan_event_id: event.plan_event_id,
    plan_step_id: event.plan_step_id || null,
    event_type: compact(event.event_type, 128),
    from_status: event.from_status || null,
    to_status: event.to_status || null,
    created_at: event.created_at || null,
  };
}

export function projectDurableOperationShadow({ plan, steps = [], events = [], principal }) {
  if (!plan?.plan_id) throw operationError(500, "DURABLE_OPERATION_PROJECTION_INVALID", "A persisted execution plan is required for shadow projection.");
  const safeSteps = steps.map(projectStep);
  const safeEvents = events.map(projectEvent);
  const state = deriveDurableOperationState(plan, safeSteps);
  const blockingGaps = deriveBlockingGaps(plan, safeSteps);
  const fingerprintInput = JSON.stringify({
    plan_id: plan.plan_id,
    tenant_id: plan.tenant_id,
    updated_at: plan.updated_at || null,
    plan_status: plan.plan_status || null,
    runtime_status: plan.runtime_status || null,
    steps: safeSteps.map(({ plan_step_id, status, attempt_count, max_attempts }) => ({ plan_step_id, status, attempt_count, max_attempts })),
  });
  const snapshotHash = sha256(fingerprintInput);
  const operation = {
    schema_version: "spec011-operation-v1",
    operation_id: plan.plan_id,
    principal,
    intent: compact(plan.intent_key || "execution_plan", 191),
    mode: plan.service_mode || null,
    plan_id: plan.plan_id,
    plan_hash: snapshotHash,
    resource_uri: `execution-plan://${plan.plan_id}`,
    resource_snapshot_hash: snapshotHash,
    approval_mode: "user_approval_only",
    delegation_grant_id: null,
    idempotency_key: compact(plan.request_id || plan.correlation_id || plan.plan_id, 191),
    state,
    risk_tier: "read_only",
    completed_steps: safeSteps.filter((step) => step.status === "completed").map((step) => step.step_key),
    blocking_gaps: blockingGaps,
    next_action: nextActionForState(state, blockingGaps),
    evidence_refs: safeEvents.map((event) => `execution-plan-event://${event.plan_event_id}`),
    created_at: plan.created_at || null,
    updated_at: plan.updated_at || null,
    expires_at: null,
    secrets_included: false,
  };
  return {
    ok: true,
    projection_mode: "shadow",
    runtime_authority: false,
    operation,
    steps: safeSteps,
    events: safeEvents,
    source: {
      authority: "execution_plans",
      step_authority: "execution_plan_steps",
      event_authority: "execution_plan_events",
      step_count: safeSteps.length,
      event_count: safeEvents.length,
      timeline_truncated: safeEvents.length >= 100,
    },
    secrets_included: false,
  };
}

export async function readDurableOperationShadow({ pool, auth = {}, operationId } = {}) {
  if (!pool) throw operationError(500, "DURABLE_OPERATION_POOL_REQUIRED", "Durable operation shadow projection requires a database pool.");
  const scope = principalClass(auth);
  if (!scope) throw operationError(403, "OPERATION_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  const normalizedOperationId = compact(operationId, 64);
  if (!normalizedOperationId) throw operationError(400, "DURABLE_OPERATION_ID_REQUIRED", "operation_id is required.");

  const tenantScoped = scope === "tenant";
  const planSql = tenantScoped
    ? `SELECT plan_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
              intent_key, request_id, correlation_id, workflow_key, workflow_id, route_key,
              service_mode, access_decision, plan_status, runtime_status, created_at, updated_at
         FROM execution_plans
        WHERE plan_id = ? AND tenant_id = ? AND user_id = ?
        LIMIT 1`
    : `SELECT plan_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
              intent_key, request_id, correlation_id, workflow_key, workflow_id, route_key,
              service_mode, access_decision, plan_status, runtime_status, created_at, updated_at
         FROM execution_plans
        WHERE plan_id = ?
        LIMIT 1`;
  const planParams = tenantScoped
    ? [normalizedOperationId, compact(auth.tenant_id, 36), compact(auth.user_id, 36)]
    : [normalizedOperationId];
  const [planRows] = await pool.query(planSql, planParams);
  const plan = planRows[0];
  if (!plan) throw operationError(404, "DURABLE_OPERATION_NOT_FOUND", "The durable operation was not found for the authenticated principal.", { operation_id: normalizedOperationId });

  const tenantClause = tenantScoped ? " AND tenant_id = ?" : "";
  const scopedParams = tenantScoped ? [normalizedOperationId, compact(auth.tenant_id, 36)] : [normalizedOperationId];
  const [steps] = await pool.query(
    `SELECT plan_step_id, plan_id, tenant_id, step_order, step_key, step_type,
            workflow_id, workflow_key, status, attempt_count, max_attempts,
            idempotency_key, claimed_at, started_at, completed_at
       FROM execution_plan_steps
      WHERE plan_id = ?${tenantClause}
      ORDER BY step_order
      LIMIT 100`,
    scopedParams,
  );
  const [events] = await pool.query(
    `SELECT plan_event_id, plan_step_id, event_type, from_status, to_status, created_at
       FROM execution_plan_events
      WHERE plan_id = ?${tenantClause}
      ORDER BY id
      LIMIT 100`,
    scopedParams,
  );

  const principal = {
    principal_type: scope,
    principal_id: compact(scope === "tenant" ? auth.user_id : (auth.user_id || auth.principal_id || "admin"), 191),
    tenant_id: scope === "tenant" ? compact(auth.tenant_id, 64) : (plan.tenant_id || null),
    workspace_id: plan.workspace_id || null,
  };
  return projectDurableOperationShadow({ plan, steps, events, principal });
}

export const _testingDurableExecutionShadowService = {
  principalClass,
  deriveBlockingGaps,
  nextActionForState,
  projectStep,
  projectEvent,
};
