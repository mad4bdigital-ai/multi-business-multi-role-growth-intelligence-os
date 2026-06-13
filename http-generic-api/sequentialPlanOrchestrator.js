import { createHash, randomUUID } from "node:crypto";

const STEP_TYPES = new Set(["workflow", "analysis", "checkpoint", "approval", "stop"]);
const TERMINAL_STEP_STATUSES = new Set(["completed", "failed", "skipped", "cancelled"]);
const TERMINAL_PLAN_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const SEQUENTIAL_PLAN_RUN_JOB_TYPE = "sequential_plan_run";

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isTruthy(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function validationError(message, code = "sequential_plan_validation_failed") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

async function withTransaction(pool, operation) {
  if (typeof pool.getConnection !== "function") return operation(pool);
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

async function appendEvent(connection, { planId, planStepId = null, tenantId, eventType, fromStatus = null, toStatus = null, actorId = null, evidence = {} }) {
  await connection.query(
    `INSERT INTO execution_plan_events
      (plan_event_id, plan_id, plan_step_id, tenant_id, event_type, from_status, to_status, actor_id, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), planId, planStepId, tenantId, eventType, fromStatus, toStatus, actorId, json({ ...evidence, secrets_included: false })]
  );
}

export function compileSequentialPlanSteps(steps = [], { planId, tenantId } = {}) {
  if (!planId || !tenantId) throw validationError("planId and tenantId are required.");
  if (!Array.isArray(steps) || steps.length === 0) throw validationError("At least one plan step is required.");
  if (steps.length > 100) throw validationError("A sequential plan may contain at most 100 steps.");

  const keys = new Set();
  return steps.map((source, index) => {
    const stepKey = String(source.step_key || source.key || `step_${index + 1}`).trim();
    if (!stepKey || keys.has(stepKey)) throw validationError(`Duplicate or empty step_key: ${stepKey || "(empty)"}`);
    keys.add(stepKey);
    const stepType = String(source.step_type || source.type || "workflow").trim();
    if (!STEP_TYPES.has(stepType)) throw validationError(`Unsupported step_type '${stepType}'.`);
    const dependsOn = source.depends_on || source.depends_on_json || (index === 0 ? [] : [String(steps[index - 1].step_key || steps[index - 1].key || `step_${index}`)]);
    if (!Array.isArray(dependsOn)) throw validationError(`depends_on must be an array for '${stepKey}'.`);
    for (const dependency of dependsOn) {
      if (!keys.has(String(dependency))) throw validationError(`Step '${stepKey}' depends on unknown or later step '${dependency}'.`);
    }
    const approvalPolicy = parseJson(source.approval_policy_json || source.approval_policy, {});
    const maxAttempts = Math.max(1, Math.min(Number(source.max_attempts || source.retry_policy?.max_attempts || 1), 10));
    return {
      plan_step_id: randomUUID(),
      plan_id: planId,
      tenant_id: tenantId,
      step_order: index + 1,
      step_key: stepKey,
      step_type: stepType,
      workflow_id: source.workflow_id || null,
      workflow_key: source.workflow_key || null,
      depends_on: dependsOn.map(String),
      input: parseJson(source.input_json || source.input, {}),
      success_criteria: parseJson(source.success_criteria_json || source.success_criteria, { result_ok: true }),
      retry_policy: parseJson(source.retry_policy_json || source.retry_policy, { max_attempts: maxAttempts }),
      approval_policy: approvalPolicy,
      status: index === 0 && dependsOn.length === 0 ? "ready" : "pending",
      max_attempts: maxAttempts,
      idempotency_key: String(source.idempotency_key || sha256(`${planId}|${stepKey}`)),
    };
  });
}

export async function persistCompiledSequentialPlan({ pool, planId, tenantId, steps, actorId = null }) {
  const compiled = compileSequentialPlanSteps(steps, { planId, tenantId });
  return withTransaction(pool, async (connection) => {
    const [planRows] = await connection.query("SELECT plan_id, tenant_id, plan_status FROM execution_plans WHERE plan_id = ? LIMIT 1 FOR UPDATE", [planId]);
    const plan = planRows[0];
    if (!plan || plan.tenant_id !== tenantId) throw validationError("Execution plan not found for tenant.", "sequential_plan_not_found");
    if (!["draft", "validated"].includes(plan.plan_status)) throw validationError("Only draft or validated plans may be recompiled.", "sequential_plan_recompile_forbidden");
    await connection.query("DELETE FROM execution_plan_steps WHERE plan_id = ?", [planId]);
    for (const step of compiled) {
      await connection.query(
        `INSERT INTO execution_plan_steps
          (plan_step_id, plan_id, tenant_id, step_order, step_key, step_type, workflow_id, workflow_key,
           depends_on_json, input_json, success_criteria_json, retry_policy_json, approval_policy_json,
           status, max_attempts, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          step.plan_step_id, planId, tenantId, step.step_order, step.step_key, step.step_type,
          step.workflow_id, step.workflow_key, json(step.depends_on), json(step.input),
          json(step.success_criteria), json(step.retry_policy), json(step.approval_policy),
          step.status, step.max_attempts, step.idempotency_key,
        ]
      );
    }
    await connection.query("UPDATE execution_plans SET plan_status = 'validated', steps_json = ?, validation_errors = NULL WHERE plan_id = ?", [json(compiled), planId]);
    await appendEvent(connection, { planId, tenantId, eventType: "plan_compiled", fromStatus: plan.plan_status, toStatus: "validated", actorId, evidence: { step_count: compiled.length } });
    return { plan_id: planId, plan_status: "validated", step_count: compiled.length, steps: compiled, secrets_included: false };
  });
}

function dependenciesCompleted(step, byKey) {
  const dependencies = parseJson(step.depends_on_json, []);
  return dependencies.every((key) => byKey.get(String(key))?.status === "completed");
}

function approvalRequired(step) {
  const policy = parseJson(step.approval_policy_json, {});
  return !isTruthy(policy.approved) && (step.step_type === "approval" || isTruthy(policy.required));
}

export function verifySequentialStepResult(step, result) {
  const criteria = parseJson(step.success_criteria_json || step.success_criteria, { result_ok: true });
  const failures = [];
  if (criteria.result_ok !== false && result?.ok !== true) failures.push("result_ok_required");
  const requiredFields = Array.isArray(criteria.required_output_fields) ? criteria.required_output_fields : [];
  for (const field of requiredFields) {
    const segments = String(field).split(".").filter(Boolean);
    let current = result;
    for (const segment of segments) current = current?.[segment];
    if (current === undefined || current === null) failures.push(`missing_output_field:${field}`);
  }
  return { passed: failures.length === 0, failures };
}

async function createApprovalHold(connection, plan, step, actorId) {
  const holdId = randomUUID();
  await connection.query(
    `INSERT INTO approval_holds
      (hold_id, run_id, step_run_id, tenant_id, hold_type, requested_by, required_role, status, execution_context_json)
     VALUES (?, ?, ?, ?, 'supervisor_approval', ?, ?, 'open', ?)`,
    [
      holdId, plan.plan_id, step.plan_step_id, plan.tenant_id, actorId,
      parseJson(step.approval_policy_json, {}).required_role || "supervisor",
      json({ source: "sequential_plan_orchestrator", plan_id: plan.plan_id, plan_step_id: step.plan_step_id, secrets_included: false }),
    ]
  );
  return holdId;
}

async function claimNextStep(pool, planId, actorId) {
  return withTransaction(pool, async (connection) => {
    const [planRows] = await connection.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 1 FOR UPDATE", [planId]);
    const plan = planRows[0];
    if (!plan) throw validationError("Execution plan not found.", "sequential_plan_not_found");
    if (TERMINAL_PLAN_STATUSES.has(plan.plan_status)) return { stop: true, reason: "plan_terminal", plan_status: plan.plan_status };
    const [steps] = await connection.query("SELECT * FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order FOR UPDATE", [planId]);
    if (!steps.length) throw validationError("Plan has no compiled steps.", "sequential_plan_not_compiled");
    const byKey = new Map(steps.map((step) => [step.step_key, step]));
    for (const step of steps) {
      if (step.status === "pending" && dependenciesCompleted(step, byKey)) {
        step.status = "ready";
        await connection.query("UPDATE execution_plan_steps SET status = 'ready' WHERE plan_step_id = ? AND status = 'pending'", [step.plan_step_id]);
      }
    }
    const next = steps.find((step) => step.status === "ready");
    if (!next) {
      const failed = steps.some((step) => step.status === "failed" || step.status === "blocked");
      const completed = steps.every((step) => TERMINAL_STEP_STATUSES.has(step.status));
      const awaitingApproval = steps.some((step) => step.status === "awaiting_approval");
      const active = steps.some((step) => ["claimed", "running", "verifying"].includes(step.status));
      const status = failed ? "blocked" : completed ? "completed" : awaitingApproval ? "awaiting_approval" : active ? "executing" : "paused";
      await connection.query("UPDATE execution_plans SET plan_status = ? WHERE plan_id = ?", [status, planId]);
      await appendEvent(connection, { planId, tenantId: plan.tenant_id, eventType: "plan_checkpoint", fromStatus: plan.plan_status, toStatus: status, actorId, evidence: { reason: completed ? "all_steps_terminal" : "no_ready_step" } });
      return { stop: true, reason: completed ? "completed" : awaitingApproval ? "awaiting_approval" : "no_ready_step", plan_status: status };
    }
    if (approvalRequired(next)) {
      const holdId = await createApprovalHold(connection, plan, next, actorId);
      await connection.query("UPDATE execution_plan_steps SET status = 'awaiting_approval' WHERE plan_step_id = ?", [next.plan_step_id]);
      await connection.query("UPDATE execution_plans SET plan_status = 'awaiting_approval' WHERE plan_id = ?", [planId]);
      await appendEvent(connection, { planId, planStepId: next.plan_step_id, tenantId: plan.tenant_id, eventType: "approval_requested", fromStatus: "ready", toStatus: "awaiting_approval", actorId, evidence: { hold_id: holdId } });
      return { stop: true, reason: "awaiting_approval", plan_status: "awaiting_approval", hold_id: holdId, step: next };
    }
    const claimToken = randomUUID();
    await connection.query(
      `UPDATE execution_plan_steps
          SET status = 'claimed', claim_token = ?, claimed_at = NOW(), attempt_count = attempt_count + 1
        WHERE plan_step_id = ? AND status = 'ready'`,
      [claimToken, next.plan_step_id]
    );
    await connection.query("UPDATE execution_plans SET plan_status = 'executing' WHERE plan_id = ?", [planId]);
    await appendEvent(connection, { planId, planStepId: next.plan_step_id, tenantId: plan.tenant_id, eventType: "step_claimed", fromStatus: "ready", toStatus: "claimed", actorId, evidence: { claim_token: claimToken } });
    return { stop: false, plan, step: { ...next, claim_token: claimToken }, claim_token: claimToken };
  });
}

async function defaultStepExecutor(step, { pool }) {
  if (step.step_type === "stop") return { ok: true, stopped: true };
  if (step.step_type === "analysis" || step.step_type === "checkpoint") {
    return { ok: true, output: parseJson(step.input_json, {}), execution_mode: "internal" };
  }
  if (step.step_type !== "workflow") throw validationError(`No executor for step type '${step.step_type}'.`, "sequential_step_executor_missing");
  const childPlanId = randomUUID();
  const [parentRows] = await pool.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 1", [step.plan_id]);
  const parent = parentRows[0];
  await pool.query(
    `INSERT INTO execution_plans
      (plan_id, tenant_id, user_id, intent_key, brand_key, target_key, workflow_key, workflow_id,
       route_key, agent_id, service_mode, access_decision, plan_status, steps_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated', ?)`,
    [
      childPlanId, parent.tenant_id, parent.user_id, parent.intent_key, parent.brand_key, parent.target_key,
      step.workflow_key || parent.workflow_key, step.workflow_id || parent.workflow_id, parent.route_key,
      parent.agent_id, parent.service_mode, parent.access_decision,
      json([{ parent_plan_id: step.plan_id, parent_plan_step_id: step.plan_step_id }]),
    ]
  );
  const { dispatchPlan } = await import("./connectorExecutor.js");
  return dispatchPlan(childPlanId, { deps: { parent_plan_id: step.plan_id, parent_plan_step_id: step.plan_step_id } });
}

async function finalizeClaim(pool, claim, result, error, actorId) {
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM execution_plan_steps WHERE plan_step_id = ? AND claim_token = ? LIMIT 1 FOR UPDATE",
      [claim.step.plan_step_id, claim.claim_token]
    );
    const step = rows[0];
    if (!step) throw validationError("Plan step claim was lost.", "sequential_step_claim_lost");
    const succeeded = !error && result?.ok !== false;
    const retryable = !succeeded && Number(step.attempt_count || 0) < Number(step.max_attempts || 1);
    const status = succeeded ? "completed" : retryable ? "retrying" : "failed";
    await connection.query(
      `UPDATE execution_plan_steps
          SET status = ?, output_json = ?, error_json = ?, completed_at = CASE WHEN ? IN ('completed','failed') THEN NOW() ELSE completed_at END,
              claim_token = NULL
        WHERE plan_step_id = ? AND claim_token = ?`,
      [status, succeeded ? json(result) : null, error ? json({ code: error.code || "step_execution_failed", message: error.message }) : null, status, step.plan_step_id, claim.claim_token]
    );
    if (retryable) await connection.query("UPDATE execution_plan_steps SET status = 'ready' WHERE plan_step_id = ? AND status = 'retrying'", [step.plan_step_id]);
    const planStatus = succeeded ? "executing" : retryable ? "executing" : "blocked";
    await connection.query("UPDATE execution_plans SET plan_status = ? WHERE plan_id = ?", [planStatus, step.plan_id]);
    await appendEvent(connection, { planId: step.plan_id, planStepId: step.plan_step_id, tenantId: step.tenant_id, eventType: succeeded ? "step_completed" : retryable ? "step_retry_scheduled" : "step_failed", fromStatus: "claimed", toStatus: status, actorId, evidence: succeeded ? { result_ok: true } : { error_code: error?.code || "step_execution_failed" } });
    return { step_status: retryable ? "ready" : status, plan_status: planStatus };
  });
}

export async function tickSequentialPlan({ pool, planId, actorId = null, executeStep = defaultStepExecutor }) {
  const claim = await claimNextStep(pool, planId, actorId);
  if (claim.stop) return { ok: true, plan_id: planId, ...claim, secrets_included: false };
  let result;
  let executionError = null;
  try {
    result = await executeStep(claim.step, { pool, plan: claim.plan });
    const verification = verifySequentialStepResult(claim.step, result);
    if (!verification.passed) {
      executionError = validationError(
        `Sequential step verification failed: ${verification.failures.join(", ")}`,
        "sequential_step_verification_failed"
      );
    }
  } catch (error) {
    executionError = error;
  }
  const final = await finalizeClaim(pool, claim, result, executionError, actorId);
  return {
    ok: !executionError && result?.ok !== false,
    plan_id: planId,
    plan_step_id: claim.step.plan_step_id,
    step_key: claim.step.step_key,
    result: executionError ? undefined : result,
    error: executionError ? { code: executionError.code || "step_execution_failed", message: executionError.message } : undefined,
    ...final,
    secrets_included: false,
  };
}

export async function runSequentialPlan({ pool, planId, actorId = null, maxTicks = 25, executeStep = defaultStepExecutor }) {
  const ticks = [];
  for (let index = 0; index < Math.max(1, Math.min(Number(maxTicks) || 25, 100)); index += 1) {
    const tick = await tickSequentialPlan({ pool, planId, actorId, executeStep });
    ticks.push(tick);
    if (tick.stop || ["blocked", "failed", "completed", "awaiting_approval", "paused"].includes(tick.plan_status)) break;
  }
  const lastTick = ticks.at(-1);
  const ok = !["blocked", "failed"].includes(lastTick?.plan_status);
  return {
    ok,
    plan_id: planId,
    tick_count: ticks.length,
    recovered_failure_count: ok ? ticks.filter((tick) => tick.ok === false).length : 0,
    last_tick: lastTick,
    ticks,
    secrets_included: false,
  };
}

export async function resumeSequentialPlan({ pool, planId, actorId = null }) {
  return withTransaction(pool, async (connection) => {
    const [steps] = await connection.query("SELECT * FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order FOR UPDATE", [planId]);
    if (!steps.length) throw validationError("Compiled plan not found.", "sequential_plan_not_compiled");
    const resumable = steps.find((step) => step.status === "paused" || step.status === "blocked" || step.status === "retrying");
    if (resumable) await connection.query("UPDATE execution_plan_steps SET status = 'ready' WHERE plan_step_id = ?", [resumable.plan_step_id]);
    await connection.query("UPDATE execution_plans SET plan_status = 'validated' WHERE plan_id = ?", [planId]);
    await appendEvent(connection, { planId, tenantId: steps[0].tenant_id, eventType: "plan_resumed", toStatus: "validated", actorId, evidence: { resumed_step_id: resumable?.plan_step_id || null } });
    return { ok: true, plan_id: planId, plan_status: "validated", resumed_step_id: resumable?.plan_step_id || null, secrets_included: false };
  });
}

export async function getSequentialPlanTimeline({ pool, planId }) {
  const [planRows] = await pool.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 1", [planId]);
  if (!planRows[0]) return null;
  const [steps] = await pool.query("SELECT * FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order", [planId]);
  const [events] = await pool.query("SELECT * FROM execution_plan_events WHERE plan_id = ? ORDER BY id", [planId]);
  return { plan: planRows[0], steps, events };
}
