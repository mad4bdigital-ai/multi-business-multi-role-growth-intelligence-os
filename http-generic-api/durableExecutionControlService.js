import { createHash, randomUUID } from "node:crypto";
import {
  defaultSequentialStepExecutor,
  runSequentialPlan,
  tickSequentialPlan,
} from "./sequentialPlanOrchestrator.js";

const TERMINAL_PLAN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_STEP_STATUSES = new Set(["completed", "failed", "skipped", "cancelled"]);

const PLAN_TRANSITIONS = new Map([
  ["draft", new Set(["validated", "cancelled"])],
  ["validated", new Set(["approved", "executing", "paused", "blocked", "cancelled"])],
  ["approved", new Set(["executing", "paused", "blocked", "cancelled"])],
  ["executing", new Set(["awaiting_approval", "paused", "blocked", "completed", "failed", "cancelled"])],
  ["awaiting_approval", new Set(["validated", "executing", "paused", "blocked", "failed", "cancelled"])],
  ["paused", new Set(["validated", "executing", "blocked", "cancelled"])],
  ["blocked", new Set(["validated", "paused", "failed", "cancelled"])],
  ["completed", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);

function durableError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function effectivePlanStatus(plan = {}) {
  return String(plan.runtime_status || plan.plan_status || "draft");
}

function persistedPlanStatus(runtimeStatus) {
  if (runtimeStatus === "blocked") return "failed";
  if (["awaiting_approval", "paused"].includes(runtimeStatus)) return "validated";
  return runtimeStatus;
}

async function withTransaction(pool, operation) {
  if (typeof pool?.getConnection !== "function") return operation(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function appendEvent(connection, {
  planId,
  planStepId = null,
  tenantId,
  eventType,
  fromStatus = null,
  toStatus = null,
  actorId = null,
  evidence = {},
}) {
  await connection.query(
    `INSERT INTO execution_plan_events
      (plan_event_id, plan_id, plan_step_id, tenant_id, event_type, from_status, to_status, actor_id, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), planId, planStepId, tenantId, eventType, fromStatus, toStatus, actorId,
      JSON.stringify({ ...evidence, secrets_included: false }),
    ],
  );
}

function resolveUnique(rows, code, message) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw durableError(message, code, 409);
  const [candidate] = candidates;
  return candidate;
}

export function assertDurablePlanTransition(fromStatus, toStatus) {
  const from = String(fromStatus || "draft");
  const to = String(toStatus || "");
  if (!PLAN_TRANSITIONS.has(from)) {
    throw durableError(`Unknown current plan status '${from}'.`, "durable_execution_status_unknown", 409);
  }
  if (from === to) return true;
  if (!PLAN_TRANSITIONS.get(from).has(to)) {
    throw durableError(
      `Plan transition '${from}' -> '${to}' is not allowed.`,
      "durable_execution_transition_forbidden",
      409,
      { from_status: from, to_status: to },
    );
  }
  return true;
}

export function projectDurableNextAction({ plan = {}, steps = [], blockers = [] } = {}) {
  const status = effectivePlanStatus(plan);
  const safeBlockers = Array.isArray(blockers) ? blockers : [];
  if (TERMINAL_PLAN_STATUSES.has(status)) return null;

  const awaiting = steps.find((step) => step.status === "awaiting_approval");
  if (status === "awaiting_approval" || awaiting) {
    return {
      type: "approval_required",
      operation: "decide_approval",
      plan_step_id: awaiting?.plan_step_id || null,
      step_key: awaiting?.step_key || null,
    };
  }

  const failed = steps.find((step) => ["blocked", "failed"].includes(step.status));
  if (status === "blocked" || failed || safeBlockers.length > 0) {
    return {
      type: "repair_required",
      operation: "explain_and_repair",
      blocker_code: safeBlockers[0]?.code || failed?.error_json?.code || "durable_execution_blocked",
      plan_step_id: failed?.plan_step_id || null,
      step_key: failed?.step_key || null,
    };
  }

  if (status === "paused") return { type: "resume", operation: "resume" };
  if (status === "draft") return { type: "compile", operation: "compile" };

  const ready = steps.find((step) => step.status === "ready");
  if (ready) {
    return {
      type: "execute_step",
      operation: "tick",
      plan_step_id: ready.plan_step_id,
      step_key: ready.step_key,
    };
  }

  if (steps.some((step) => ["claimed", "running", "verifying"].includes(step.status))) {
    return { type: "poll", operation: "status" };
  }

  return { type: "run", operation: "run" };
}

export function assertDurableRequestedStatus(toStatus) {
  const requestedStatus = String(toStatus || "").trim();
  if (!PLAN_TRANSITIONS.has(requestedStatus)) {
    throw durableError(
      `Unknown requested plan status '${requestedStatus || "(empty)"}'.`,
      "invalid_status",
      400,
    );
  }
  return requestedStatus;
}

export async function transitionDurableExecution({
  pool,
  planId,
  tenantId = null,
  toStatus,
  actorId = null,
  reason = null,
}) {
  toStatus = assertDurableRequestedStatus(toStatus);
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2 FOR UPDATE",
      [planId],
    );
    const plan = resolveUnique(
      rows,
      "durable_execution_plan_ambiguous",
      "Execution plan identity resolved to multiple rows.",
    );
    if (!plan || (tenantId && String(plan.tenant_id) !== String(tenantId))) {
      throw durableError("Execution plan not found for tenant.", "durable_execution_not_found", 404);
    }
    const fromStatus = effectivePlanStatus(plan);
    assertDurablePlanTransition(fromStatus, toStatus);
    if (fromStatus !== toStatus) {
      await connection.query(
        "UPDATE execution_plans SET plan_status = ?, runtime_status = ? WHERE plan_id = ? AND tenant_id = ?",
        [persistedPlanStatus(toStatus), toStatus, planId, plan.tenant_id],
      );
      await appendEvent(connection, {
        planId,
        tenantId: plan.tenant_id,
        eventType: "plan_transitioned",
        fromStatus,
        toStatus,
        actorId,
        evidence: { reason: reason || null },
      });
    }
    return {
      ok: true,
      plan_id: planId,
      plan_status: toStatus,
      previous_status: fromStatus,
      next_action: projectDurableNextAction({ plan: { ...plan, runtime_status: toStatus } }),
      secrets_included: false,
    };
  });
}

export async function cancelDurableExecution({ pool, planId, tenantId = null, actorId = null, reason = null }) {
  return withTransaction(pool, async (connection) => {
    const [planRows] = await connection.query(
      "SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2 FOR UPDATE",
      [planId],
    );
    const plan = resolveUnique(
      planRows,
      "durable_execution_plan_ambiguous",
      "Execution plan identity resolved to multiple rows.",
    );
    if (!plan || (tenantId && String(plan.tenant_id) !== String(tenantId))) {
      throw durableError("Execution plan not found for tenant.", "durable_execution_not_found", 404);
    }
    const fromStatus = effectivePlanStatus(plan);
    if (TERMINAL_PLAN_STATUSES.has(fromStatus)) {
      if (fromStatus === "cancelled") {
        return { ok: true, plan_id: planId, plan_status: "cancelled", idempotent_replay: true, next_action: null, secrets_included: false };
      }
      throw durableError(
        `Terminal plan '${fromStatus}' cannot be cancelled.`,
        "durable_execution_terminal_invariant",
        409,
      );
    }
    assertDurablePlanTransition(fromStatus, "cancelled");
    await connection.query(
      `UPDATE execution_plan_steps
          SET status = 'cancelled', claim_token = NULL, completed_at = COALESCE(completed_at, NOW())
        WHERE plan_id = ? AND status NOT IN ('completed','failed','skipped','cancelled')`,
      [planId],
    );
    await connection.query(
      "UPDATE execution_plans SET plan_status = 'cancelled', runtime_status = 'cancelled' WHERE plan_id = ? AND tenant_id = ?",
      [planId, plan.tenant_id],
    );
    await appendEvent(connection, {
      planId,
      tenantId: plan.tenant_id,
      eventType: "plan_cancelled",
      fromStatus,
      toStatus: "cancelled",
      actorId,
      evidence: { reason: reason || "user_requested" },
    });
    return { ok: true, plan_id: planId, plan_status: "cancelled", next_action: null, secrets_included: false };
  });
}

export async function getDurableExecutionStatus({ pool, planId, tenantId = null }) {
  const [planRows] = await pool.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2", [planId]);
  const plan = resolveUnique(
    planRows,
    "durable_execution_plan_ambiguous",
    "Execution plan identity resolved to multiple rows.",
  );
  if (!plan || (tenantId && String(plan.tenant_id) !== String(tenantId))) return null;
  const [stepRows] = await pool.query(
    `SELECT plan_step_id, plan_id, tenant_id, step_order, step_key, step_type, status,
            attempt_count, max_attempts, idempotency_key, error_json, completed_at, updated_at
       FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order LIMIT 500`,
    [planId],
  );
  const steps = stepRows.map((step) => ({
    ...step,
    error_json: parseJson(step.error_json, null),
  }));
  const counts = {};
  for (const step of steps) counts[step.status] = Number(counts[step.status] || 0) + 1;
  const blockers = steps
    .filter((step) => ["blocked", "failed"].includes(step.status))
    .slice(0, 20)
    .map((step) => ({
      code: step.error_json?.code || "durable_execution_step_blocked",
      plan_step_id: step.plan_step_id,
      step_key: step.step_key,
      status: step.status,
    }));
  return {
    plan: {
      plan_id: plan.plan_id,
      tenant_id: plan.tenant_id,
      plan_status: effectivePlanStatus(plan),
      intent_key: plan.intent_key || null,
      workflow_key: plan.workflow_key || null,
      service_mode: plan.service_mode || null,
      access_decision: plan.access_decision || null,
      updated_at: plan.updated_at || null,
    },
    step_counts: counts,
    blockers,
    next_action: projectDurableNextAction({ plan, steps, blockers }),
    secrets_included: false,
  };
}

export async function explainDurableExecution({ pool, planId, tenantId = null }) {
  const status = await getDurableExecutionStatus({ pool, planId, tenantId });
  if (!status) return null;
  const planStatus = status.plan.plan_status;
  const explanation = TERMINAL_PLAN_STATUSES.has(planStatus)
    ? `Execution plan is terminal with status '${planStatus}'.`
    : status.blockers.length > 0
      ? "Execution is blocked and requires the bounded repair action described by next_action."
      : planStatus === "awaiting_approval"
        ? "Execution is paused at a human approval boundary."
        : "Execution can continue through the canonical next_action.";
  return { ...status, explanation };
}

export async function getBoundedDurableTimeline({ pool, planId, tenantId = null, limit = 100 }) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const [planRows] = await pool.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2", [planId]);
  const plan = resolveUnique(
    planRows,
    "durable_execution_plan_ambiguous",
    "Execution plan identity resolved to multiple rows.",
  );
  if (!plan || (tenantId && String(plan.tenant_id) !== String(tenantId))) return null;
  const [events] = await pool.query(
    `SELECT plan_event_id, plan_id, plan_step_id, tenant_id, event_type, from_status, to_status,
            actor_id, evidence_json, created_at
       FROM execution_plan_events WHERE plan_id = ? ORDER BY id DESC LIMIT ${boundedLimit + 1}`,
    [planId],
  );
  const hasMore = events.length > boundedLimit;
  const bounded = events.slice(0, boundedLimit).reverse().map((event) => ({
    ...event,
    evidence_json: parseJson(event.evidence_json, {}),
  }));
  return {
    plan_id: planId,
    plan_status: effectivePlanStatus(plan),
    events: bounded,
    event_count: bounded.length,
    has_more: hasMore,
    evidence_references: bounded
      .filter((event) => event.evidence_json?.evidence_ref || event.evidence_json?.receipt_id)
      .slice(-50)
      .map((event) => ({
        plan_event_id: event.plan_event_id,
        evidence_ref: event.evidence_json.evidence_ref || null,
        receipt_id: event.evidence_json.receipt_id || null,
      })),
    secrets_included: false,
  };
}

function receiptRequestHash(step) {
  return sha256(stableStringify({
    plan_id: step.plan_id,
    plan_step_id: step.plan_step_id,
    step_key: step.step_key,
    workflow_id: step.workflow_id || null,
    workflow_key: step.workflow_key || null,
    input: parseJson(step.input_json, {}),
    idempotency_key: step.idempotency_key,
  }));
}

async function claimMutationReceipt(pool, step) {
  const requestSha256 = receiptRequestHash(step);
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM execution_plan_mutation_receipts
        WHERE plan_step_id = ? AND request_sha256 = ? LIMIT 2 FOR UPDATE`,
      [step.plan_step_id, requestSha256],
    );
    const existing = resolveUnique(
      rows,
      "durable_execution_receipt_ambiguous",
      "Mutation receipt identity resolved to multiple rows.",
    );
    if (existing) {
      if (["succeeded", "reconciled"].includes(existing.dispatch_status)) {
        return {
          replay: true,
          receipt_id: existing.receipt_id,
          request_sha256: requestSha256,
          result: parseJson(existing.provider_receipt_json, { ok: true, idempotent_replay: true }),
        };
      }
      if (["pending", "unknown_outcome"].includes(existing.dispatch_status)) {
        throw durableError(
          "A prior mutation attempt has a pending or unknown outcome; readback is required before retry.",
          "durable_execution_readback_required",
          409,
          { non_retryable: true, unknown_outcome: true, receipt_id: existing.receipt_id },
        );
      }
      await connection.query(
        `UPDATE execution_plan_mutation_receipts
            SET dispatch_status = 'pending', provider_status = NULL, provider_receipt_json = NULL,
                readback_json = NULL, recovered_from_transport = 0
          WHERE receipt_id = ?`,
        [existing.receipt_id],
      );
      return { replay: false, receipt_id: existing.receipt_id, request_sha256: requestSha256 };
    }
    const receiptId = randomUUID();
    await connection.query(
      `INSERT INTO execution_plan_mutation_receipts
        (receipt_id, plan_id, plan_step_id, tenant_id, operation_key, idempotency_key,
         request_sha256, dispatch_status, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [
        receiptId,
        step.plan_id,
        step.plan_step_id,
        step.tenant_id,
        String(step.workflow_key || step.workflow_id || step.step_key || "workflow_dispatch"),
        step.idempotency_key,
        requestSha256,
      ],
    );
    return { replay: false, receipt_id: receiptId, request_sha256: requestSha256 };
  });
}

async function finalizeMutationReceipt(pool, receiptId, status, payload, providerStatus = null) {
  const safePayload = payload && typeof payload === "object" ? payload : { value: payload ?? null };
  await pool.query(
    `UPDATE execution_plan_mutation_receipts
        SET dispatch_status = ?, provider_status = ?, provider_receipt_json = ?,
            recovered_from_transport = ?
      WHERE receipt_id = ?`,
    [
      status,
      providerStatus,
      JSON.stringify({ ...safePayload, secrets_included: false }),
      status === "unknown_outcome" ? 1 : 0,
      receiptId,
    ],
  );
}

export function createDurableReceiptAwareExecutor({ pool, executeStep = defaultSequentialStepExecutor } = {}) {
  if (!pool) throw durableError("pool is required.", "durable_execution_pool_required", 500);
  if (typeof executeStep !== "function") {
    throw durableError("executeStep must be a function.", "durable_execution_executor_required", 500);
  }
  return async (step, context = {}) => {
    if (step.step_type !== "workflow") return executeStep(step, context);
    const receipt = await claimMutationReceipt(pool, step);
    if (receipt.replay) return { ...receipt.result, receipt_id: receipt.receipt_id, idempotent_replay: true };
    try {
      const result = await executeStep(step, context);
      await finalizeMutationReceipt(pool, receipt.receipt_id, "succeeded", result, result?.provider_status || null);
      return { ...result, receipt_id: receipt.receipt_id, idempotent_replay: false };
    } catch (error) {
      const preDispatch = Number(error?.status || 500) < 500 && error?.unknown_outcome !== true;
      const status = preDispatch ? "failed_pre_dispatch" : "unknown_outcome";
      await finalizeMutationReceipt(pool, receipt.receipt_id, status, {
        code: error?.code || "durable_execution_dispatch_failed",
        message: error?.message || "Workflow dispatch failed.",
      }, error?.status || null);
      if (!preDispatch) {
        error.non_retryable = true;
        error.unknown_outcome = true;
        error.receipt_id = receipt.receipt_id;
      }
      throw error;
    }
  };
}

export async function tickDurableExecution({ pool, planId, actorId = null, executeStep = null, ...rest }) {
  const executor = createDurableReceiptAwareExecutor({ pool, executeStep: executeStep || defaultSequentialStepExecutor });
  return tickSequentialPlan({ pool, planId, actorId, executeStep: executor, ...rest });
}

export async function runDurableExecution({ pool, planId, actorId = null, executeStep = null, ...rest }) {
  const executor = createDurableReceiptAwareExecutor({ pool, executeStep: executeStep || defaultSequentialStepExecutor });
  return runSequentialPlan({ pool, planId, actorId, executeStep: executor, ...rest });
}

export const durableExecutionControlContract = Object.freeze({
  version: "spec-011-phase1-v1",
  terminal_plan_statuses: [...TERMINAL_PLAN_STATUSES],
  terminal_step_statuses: [...TERMINAL_STEP_STATUSES],
  pending_mutation_receipt_required: true,
  read_before_retry_after_unknown_outcome: true,
  canonical_next_action: true,
  bounded_timeline: true,
  secrets_included: false,
});
