import { createHash, randomUUID } from "node:crypto";
import {
  assertManagedExecutionPayloadSecretFree,
  managedError,
  optionalString,
  parseJson,
  requiredString,
  sha256Json,
} from "./managedExecutionCore.js";
import { assertManagedExecutionAuthorityStillEffective } from "./managedExecutionAuthority.js";
import { appendManagedEvent, withManagedTransaction } from "./managedExecutionPersistence.js";

export const MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS = 3;
export const MANAGED_ROLLBACK_STEP_KEY = "__managed_rollback__";

const ACTIVE_STEP_STATUSES = new Set(["pending", "running", "awaiting"]);
const REASSIGNABLE_STEP_STATUSES = new Set(["pending", "awaiting", "failed"]);
const CANCELLABLE_RUN_STATUSES = new Set([
  "pending",
  "running",
  "paused",
  "awaiting_review",
  "awaiting_approval",
]);
const ROLLBACK_SOURCE_RUN_STATUSES = new Set(["completed", "failed", "paused", "cancelled"]);

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function idempotencySha(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function assertAuthoritySnapshot(context) {
  if (context?.contract !== "tenant-managed-execution-v1") {
    throw managedError(
      409,
      "managed_execution_run_contract_mismatch",
      "Run is not owned by managed execution lifecycle.",
    );
  }
  const authority = context.authority_snapshot || {};
  const { fingerprint_sha256: fingerprint, ...payload } = authority;
  if (!fingerprint || !authority.capability_key || !authority.resource?.type || !authority.resource?.ref) {
    throw managedError(
      409,
      "managed_execution_authority_snapshot_invalid",
      "Managed execution authority snapshot is incomplete.",
    );
  }
  if (sha256Json(payload) !== fingerprint) {
    throw managedError(
      409,
      "managed_execution_authority_snapshot_tampered",
      "Managed execution authority snapshot fingerprint does not match its payload.",
    );
  }
  return authority;
}

async function loadManagedState(connection, runId) {
  const [runRows] = await connection.query(
    "SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 2 FOR UPDATE",
    [runId],
  );
  if (runRows.length !== 1) {
    throw managedError(404, "managed_execution_run_not_found", "Managed execution run was not found.");
  }
  const run = runRows[0];
  const context = parseJson(run.execution_context_json, {});
  const authority = assertAuthoritySnapshot(context);

  const [bindingRows] = await connection.query(
    "SELECT * FROM managed_execution_bindings WHERE run_id = ? LIMIT 2 FOR UPDATE",
    [runId],
  );
  if (bindingRows.length !== 1) {
    throw managedError(
      409,
      "managed_execution_binding_missing",
      "Managed execution binding is missing or ambiguous.",
    );
  }
  const [holds] = await connection.query(
    "SELECT * FROM approval_holds WHERE run_id = ? ORDER BY id FOR UPDATE",
    [runId],
  );
  const [steps] = await connection.query(
    "SELECT * FROM step_runs WHERE run_id = ? ORDER BY id FOR UPDATE",
    [runId],
  );
  return { run, context, authority, binding: bindingRows[0], holds, steps };
}

function findStep(state, stepRunId) {
  const rows = state.steps.filter((step) => String(step.step_run_id) === String(stepRunId));
  if (rows.length !== 1) {
    throw managedError(
      rows.length ? 409 : 404,
      rows.length ? "managed_execution_step_ambiguous" : "managed_execution_step_not_found",
      rows.length
        ? "Managed execution step is ambiguous."
        : "Managed execution step was not found.",
    );
  }
  return rows[0];
}

function activeSteps(state, excludedStepRunId = null) {
  return state.steps.filter(
    (step) =>
      ACTIVE_STEP_STATUSES.has(normalized(step.status))
      && String(step.step_run_id) !== String(excludedStepRunId || ""),
  );
}

function openHolds(state) {
  return state.holds.filter((hold) => normalized(hold.status) === "open");
}

function assertNoOpenHolds(state, operation) {
  const holds = openHolds(state);
  if (holds.length) {
    throw managedError(
      409,
      "managed_execution_approval_pending",
      `Managed execution cannot ${operation} while an approval hold is open.`,
      { hold_ids: holds.map((hold) => hold.hold_id) },
    );
  }
}

async function assertLiveAuthority(connection, state) {
  await assertManagedExecutionAuthorityStillEffective({
    connection,
    authoritySnapshot: state.authority,
  });
}

async function findRecoveryEventByIdempotency({ connection, bindingId, eventType, idempotencyHash }) {
  const [rows] = await connection.query(
    `SELECT event_id, evidence_json
       FROM managed_execution_events
      WHERE binding_id = ? AND event_type = ?
      ORDER BY id DESC LIMIT 25 FOR UPDATE`,
    [bindingId, eventType],
  );
  return rows.find((row) => {
    const evidence = parseJson(row.evidence_json, {});
    return evidence.idempotency_key_sha256 === idempotencyHash;
  }) || null;
}

async function assertActiveAssignee({ connection, tenantId, assignedTo }) {
  const [rows] = await connection.query(
    `SELECT user_id, role, status
       FROM memberships
      WHERE tenant_id = ? AND user_id = ?
      LIMIT 2 FOR UPDATE`,
    [tenantId, assignedTo],
  );
  if (rows.length > 1) {
    throw managedError(
      409,
      "managed_execution_assignee_membership_ambiguous",
      "Managed execution assignee membership resolved to multiple rows.",
    );
  }
  const membership = rows[0] || null;
  if (!membership || normalized(membership.status) !== "active") {
    throw managedError(
      403,
      "managed_execution_assignee_active_membership_required",
      "Managed execution reassignment requires an active membership in the run tenant.",
    );
  }
  return {
    user_id: membership.user_id,
    role: membership.role || null,
    status: membership.status,
    secrets_included: false,
  };
}

export function assertManagedExecutionStepTransition({ current_status, next_status }) {
  const current = normalized(current_status);
  const next = normalized(next_status);
  if (current && current === next) return true;
  const allowed = {
    pending: new Set(["running", "failed", "skipped", "awaiting"]),
    running: new Set(["completed", "failed", "skipped", "awaiting"]),
    awaiting: new Set(["pending", "running", "failed", "skipped"]),
    failed: new Set(),
    completed: new Set(),
    skipped: new Set(),
  };
  if (!allowed[current]?.has(next)) {
    throw managedError(
      409,
      "managed_execution_step_transition_forbidden",
      `Managed execution step cannot transition from '${current}' to '${next}'.`,
    );
  }
  return true;
}

export function assertManagedExecutionRetryBound({ attempt, maxAttempts = MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS }) {
  const currentAttempt = Number(attempt || 1);
  const limit = Number(maxAttempts || MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS);
  if (!Number.isInteger(currentAttempt) || currentAttempt < 1) {
    throw managedError(409, "managed_execution_retry_attempt_invalid", "Managed execution step attempt is invalid.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw managedError(400, "managed_execution_retry_limit_invalid", "Managed execution retry limit must be between 1 and 10.");
  }
  if (currentAttempt >= limit) {
    throw managedError(
      409,
      "managed_execution_retry_limit_reached",
      `Managed execution step reached the retry limit of ${limit} attempts.`,
      { attempt: currentAttempt, max_attempts: limit },
    );
  }
  return { attempt: currentAttempt, next_attempt: currentAttempt + 1, max_attempts: limit };
}

export async function syncManagedExecutionStepStatus({
  pool,
  runId,
  stepRunId,
  nextStatus,
  actorId = null,
  output = null,
  errorMessage = null,
}) {
  assertManagedExecutionPayloadSecretFree(output, "step.output");
  const normalizedStatus = requiredString(nextStatus, "status", 32).toLowerCase();
  const normalizedError = optionalString(errorMessage, 512);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    const step = findStep(state, stepRunId);
    if (normalized(step.status) === normalizedStatus) {
      return {
        ok: true,
        reused: true,
        run_id: runId,
        step_run_id: stepRunId,
        status: step.status,
        secrets_included: false,
      };
    }
    assertManagedExecutionStepTransition({ current_status: step.status, next_status: normalizedStatus });

    if (normalizedStatus === "running") {
      assertNoOpenHolds(state, "start a step");
      await assertLiveAuthority(connection, state);
      if (!["pending", "running", "paused"].includes(normalized(state.run.status))) {
        throw managedError(
          409,
          "managed_execution_run_not_recoverable",
          `Run status '${state.run.status}' is not eligible to start a managed step.`,
        );
      }
    }

    await connection.query(
      `UPDATE step_runs
          SET status = ?,
              output_json = CASE WHEN ? IS NULL THEN output_json ELSE ? END,
              error_message = ?,
              started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
              completed_at = CASE WHEN ? IN ('completed','failed','skipped') THEN NOW() ELSE NULL END
        WHERE step_run_id = ? AND run_id = ?`,
      [
        normalizedStatus,
        output === null ? null : 1,
        output === null ? null : JSON.stringify(output),
        normalizedError,
        normalizedStatus,
        normalizedStatus,
        stepRunId,
        runId,
      ],
    );

    let lifecycleState = state.binding.lifecycle_state;
    let customerStatus = state.binding.customer_status;
    if (normalizedStatus === "running") {
      await connection.query(
        "UPDATE workflow_runs SET status = 'running', started_at = COALESCE(started_at, NOW()), completed_at = NULL WHERE run_id = ?",
        [runId],
      );
      lifecycleState = state.binding.lifecycle_state === "rollback_executing" ? "rollback_executing" : "executing";
      customerStatus = "in_progress";
    } else if (normalizedStatus === "failed") {
      await connection.query(
        "UPDATE workflow_runs SET status = 'paused', completed_at = NULL WHERE run_id = ?",
        [runId],
      );
      lifecycleState = "blocked";
      customerStatus = "blocked";
    }

    if (lifecycleState !== state.binding.lifecycle_state || customerStatus !== state.binding.customer_status) {
      await connection.query(
        "UPDATE managed_execution_bindings SET lifecycle_state = ?, customer_status = ? WHERE binding_id = ?",
        [lifecycleState, customerStatus, state.binding.binding_id],
      );
      await connection.query(
        "UPDATE tickets SET lifecycle_state = ?, customer_status = ?, status = 'in_review', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
        [lifecycleState, customerStatus, state.binding.task_ticket_id, state.binding.tenant_id],
      );
    }

    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_step_status_changed",
      fromState: state.binding.lifecycle_state,
      toState: lifecycleState,
      actorId,
      evidence: {
        step_run_id: stepRunId,
        from_status: step.status,
        to_status: normalizedStatus,
        attempt: Number(step.attempt || 1),
      },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      step_run_id: stepRunId,
      status: normalizedStatus,
      lifecycle_state: lifecycleState,
      customer_status: customerStatus,
      secrets_included: false,
    };
  });
}

export async function retryManagedExecutionStep({
  pool,
  runId,
  stepRunId,
  idempotencyKey,
  actorId = null,
  reason = null,
  maxAttempts = MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS,
}) {
  const key = requiredString(idempotencyKey, "idempotency_key", 191);
  const normalizedReason = optionalString(reason, 512);
  const keyHash = idempotencySha(key);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    const step = findStep(state, stepRunId);
    const priorEvent = await findRecoveryEventByIdempotency({
      connection,
      bindingId: state.binding.binding_id,
      eventType: "managed_step_retry_requested",
      idempotencyHash: keyHash,
    });
    if (priorEvent) {
      return {
        ok: true,
        reused: true,
        run_id: runId,
        step_run_id: stepRunId,
        attempt: Number(step.attempt || 1),
        secrets_included: false,
      };
    }
    if (normalized(step.status) !== "failed") {
      throw managedError(
        409,
        "managed_execution_retry_requires_failed_step",
        "Only a failed managed execution step can be retried.",
      );
    }
    if (!["paused", "failed"].includes(normalized(state.run.status))) {
      throw managedError(
        409,
        "managed_execution_retry_run_status_invalid",
        `Run status '${state.run.status}' is not eligible for retry.`,
      );
    }
    assertNoOpenHolds(state, "retry a step");
    const otherActive = activeSteps(state, stepRunId);
    if (otherActive.length) {
      throw managedError(
        409,
        "managed_execution_retry_other_steps_active",
        "Managed execution retry requires all other linked steps to be inactive.",
        { active_steps: otherActive.map((row) => row.step_run_id) },
      );
    }
    const retry = assertManagedExecutionRetryBound({ attempt: step.attempt, maxAttempts });
    await assertLiveAuthority(connection, state);

    await connection.query(
      `UPDATE step_runs
          SET status = 'pending', attempt = ?, output_json = NULL, error_message = NULL,
              started_at = NULL, completed_at = NULL
        WHERE step_run_id = ? AND run_id = ?`,
      [retry.next_attempt, stepRunId, runId],
    );
    await connection.query(
      "UPDATE workflow_runs SET status = 'running', error_json = NULL, completed_at = NULL, started_at = COALESCE(started_at, NOW()) WHERE run_id = ?",
      [runId],
    );
    await connection.query(
      "UPDATE managed_execution_bindings SET lifecycle_state = 'executing', customer_status = 'in_progress' WHERE binding_id = ?",
      [state.binding.binding_id],
    );
    await connection.query(
      "UPDATE tickets SET lifecycle_state = 'executing', customer_status = 'in_progress', status = 'in_review', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
      [state.binding.task_ticket_id, state.binding.tenant_id],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_step_retry_requested",
      fromState: state.binding.lifecycle_state,
      toState: "executing",
      actorId,
      evidence: {
        step_run_id: stepRunId,
        previous_attempt: retry.attempt,
        next_attempt: retry.next_attempt,
        max_attempts: retry.max_attempts,
        idempotency_key_sha256: keyHash,
        reason: normalizedReason,
      },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      step_run_id: stepRunId,
      status: "pending",
      attempt: retry.next_attempt,
      max_attempts: retry.max_attempts,
      lifecycle_state: "executing",
      customer_status: "in_progress",
      secrets_included: false,
    };
  });
}

export async function reassignManagedExecutionStep({
  pool,
  runId,
  stepRunId,
  assignedTo,
  actorId = null,
  reason = null,
}) {
  const assignee = requiredString(assignedTo, "assigned_to", 64);
  const normalizedReason = optionalString(reason, 512);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    const step = findStep(state, stepRunId);
    if (!REASSIGNABLE_STEP_STATUSES.has(normalized(step.status))) {
      throw managedError(
        409,
        "managed_execution_step_not_reassignable",
        `Step status '${step.status}' cannot be reassigned.`,
      );
    }
    const membership = await assertActiveAssignee({
      connection,
      tenantId: state.binding.tenant_id,
      assignedTo: assignee,
    });
    if (String(step.assigned_to || "") === assignee) {
      return {
        ok: true,
        reused: true,
        run_id: runId,
        step_run_id: stepRunId,
        assigned_to: assignee,
        membership,
        secrets_included: false,
      };
    }
    await connection.query(
      "UPDATE step_runs SET assigned_to = ? WHERE step_run_id = ? AND run_id = ?",
      [assignee, stepRunId, runId],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_step_reassigned",
      fromState: state.binding.lifecycle_state,
      toState: state.binding.lifecycle_state,
      actorId,
      evidence: {
        step_run_id: stepRunId,
        previous_assigned_to: step.assigned_to || null,
        assigned_to: assignee,
        assignee_role: membership.role,
        reason: normalizedReason,
      },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      step_run_id: stepRunId,
      assigned_to: assignee,
      membership,
      secrets_included: false,
    };
  });
}

export async function escalateManagedExecutionRun({
  pool,
  runId,
  actorId = null,
  reason = null,
  assignedTo = null,
}) {
  const normalizedReason = optionalString(reason, 512);
  const assignee = optionalString(assignedTo, 64);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    if (!["paused", "failed"].includes(normalized(state.run.status))) {
      throw managedError(
        409,
        "managed_execution_escalation_status_invalid",
        "Managed execution escalation requires a paused or failed run.",
      );
    }
    const running = state.steps.filter((step) => normalized(step.status) === "running");
    if (running.length) {
      throw managedError(
        409,
        "managed_execution_escalation_steps_running",
        "Managed execution cannot escalate while linked steps are running.",
        { running_steps: running.map((step) => step.step_run_id) },
      );
    }
    const existing = openHolds(state);
    if (existing.length) {
      const supervisor = existing.find((hold) => normalized(hold.required_role) === "supervisor");
      if (supervisor) {
        return {
          ok: true,
          reused: true,
          run_id: runId,
          hold_id: supervisor.hold_id,
          run_status: "awaiting_approval",
          lifecycle_state: "escalated",
          secrets_included: false,
        };
      }
      throw managedError(
        409,
        "managed_execution_escalation_hold_conflict",
        "A different approval hold is already open for this managed execution.",
      );
    }
    if (assignee) {
      await assertActiveAssignee({
        connection,
        tenantId: state.binding.tenant_id,
        assignedTo: assignee,
      });
    }

    const holdId = randomUUID();
    await connection.query(
      `INSERT INTO approval_holds
         (hold_id, run_id, tenant_id, workspace_id, workspace_key, requested_by, user_id,
          actor_id, actor_type, brand_id, brand_key, request_id, session_id, conversation_id,
          correlation_id, execution_context_json, hold_type, assigned_to, required_role, status, expires_at)
       SELECT ?, run_id, tenant_id, workspace_id, workspace_key, ?, user_id,
              ?, 'operator', brand_id, brand_key, request_id, session_id, conversation_id,
              correlation_id,
              JSON_OBJECT('source','managed_execution_lifecycle','contract','tenant-managed-execution-v1',
                          'binding_id',?,'escalation_reason',?,'secrets_included',FALSE),
              'supervisor_approval', ?, 'supervisor', 'open', DATE_ADD(NOW(), INTERVAL 24 HOUR)
         FROM workflow_runs WHERE run_id = ?`,
      [
        holdId,
        actorId || state.run.user_id || null,
        actorId || state.run.user_id || null,
        state.binding.binding_id,
        normalizedReason,
        assignee,
        runId,
      ],
    );
    await connection.query(
      "UPDATE workflow_runs SET status = 'awaiting_approval', completed_at = NULL WHERE run_id = ?",
      [runId],
    );
    await connection.query(
      "UPDATE managed_execution_bindings SET lifecycle_state = 'escalated', customer_status = 'waiting_for_approval', approval_hold_id = ? WHERE binding_id = ?",
      [holdId, state.binding.binding_id],
    );
    await connection.query(
      "UPDATE tickets SET lifecycle_state = 'escalated', customer_status = 'waiting_for_approval', status = 'awaiting_approval', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
      [state.binding.task_ticket_id, state.binding.tenant_id],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_execution_escalated",
      fromState: state.binding.lifecycle_state,
      toState: "escalated",
      actorId,
      evidence: { hold_id: holdId, assigned_to: assignee, reason: normalizedReason },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      hold_id: holdId,
      run_status: "awaiting_approval",
      lifecycle_state: "escalated",
      customer_status: "waiting_for_approval",
      secrets_included: false,
    };
  });
}

export async function cancelManagedExecutionRun({
  pool,
  runId,
  actorId = null,
  reason = null,
}) {
  const normalizedReason = optionalString(reason, 512);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    const status = normalized(state.run.status);
    if (status === "cancelled") {
      return {
        ok: true,
        reused: true,
        run_id: runId,
        status: "cancelled",
        lifecycle_state: state.binding.lifecycle_state,
        customer_status: state.binding.customer_status,
        secrets_included: false,
      };
    }
    if (!CANCELLABLE_RUN_STATUSES.has(status)) {
      throw managedError(
        409,
        "managed_execution_run_not_cancellable",
        `Run status '${state.run.status}' cannot be cancelled.`,
      );
    }
    const active = activeSteps(state);
    const holds = openHolds(state);
    if (active.length) {
      await connection.query(
        `UPDATE step_runs
            SET status = 'skipped', error_message = ?, completed_at = NOW()
          WHERE run_id = ? AND status IN ('pending','running','awaiting')`,
        [normalizedReason || "Managed execution cancelled.", runId],
      );
    }
    if (holds.length) {
      await connection.query(
        `UPDATE approval_holds
            SET status = 'rejected', decision_by = ?, decision_note = ?, decided_at = NOW()
          WHERE run_id = ? AND status = 'open'`,
        [actorId || "system", normalizedReason || "Managed execution cancelled.", runId],
      );
    }
    await connection.query(
      "UPDATE workflow_runs SET status = 'cancelled', completed_at = NOW() WHERE run_id = ?",
      [runId],
    );
    await connection.query(
      "UPDATE managed_execution_bindings SET lifecycle_state = 'cancelled', customer_status = 'cancelled' WHERE binding_id = ?",
      [state.binding.binding_id],
    );
    await connection.query(
      "UPDATE tickets SET lifecycle_state = 'cancelled', customer_status = 'cancelled', status = 'resolved', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
      [state.binding.task_ticket_id, state.binding.tenant_id],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_execution_cancelled",
      fromState: state.binding.lifecycle_state,
      toState: "cancelled",
      actorId,
      evidence: {
        reason: normalizedReason,
        skipped_step_count: active.length,
        rejected_hold_count: holds.length,
      },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      status: "cancelled",
      lifecycle_state: "cancelled",
      customer_status: "cancelled",
      skipped_step_count: active.length,
      rejected_hold_count: holds.length,
      secrets_included: false,
    };
  });
}

export async function requestManagedExecutionRollback({
  pool,
  runId,
  idempotencyKey,
  actorId = null,
  assignedTo = null,
  reason = null,
}) {
  const key = requiredString(idempotencyKey, "idempotency_key", 191);
  const assignee = optionalString(assignedTo, 64);
  const normalizedReason = optionalString(reason, 512);
  const keyHash = idempotencySha(key);

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    if (state.binding.lifecycle_state === "rolled_back") {
      return {
        ok: true,
        reused: true,
        finalized: true,
        run_id: runId,
        lifecycle_state: "rolled_back",
        secrets_included: false,
      };
    }
    if (!ROLLBACK_SOURCE_RUN_STATUSES.has(normalized(state.run.status))) {
      throw managedError(
        409,
        "managed_execution_rollback_status_invalid",
        `Run status '${state.run.status}' is not eligible for rollback.`,
      );
    }
    if (normalized(state.authority.effect_class) === "read_only") {
      throw managedError(
        409,
        "managed_execution_rollback_not_required",
        "Read-only managed execution does not support rollback.",
      );
    }
    assertNoOpenHolds(state, "request rollback");
    const active = activeSteps(state);
    if (active.length) {
      throw managedError(
        409,
        "managed_execution_rollback_steps_active",
        "Rollback requires all linked steps to be inactive.",
        { active_steps: active.map((step) => step.step_run_id) },
      );
    }

    const [requestRows] = await connection.query(
      "SELECT * FROM managed_execution_step_requests WHERE run_id = ? AND idempotency_key = ? LIMIT 2 FOR UPDATE",
      [runId, key],
    );
    if (requestRows.length > 1) {
      throw managedError(
        409,
        "managed_execution_rollback_idempotency_ambiguous",
        "Rollback idempotency key resolved to multiple requests.",
      );
    }
    if (requestRows.length === 1) {
      const existing = requestRows[0];
      const [stepRows] = await connection.query(
        "SELECT * FROM step_runs WHERE step_run_id = ? LIMIT 1",
        [existing.step_run_id],
      );
      return {
        ok: true,
        reused: true,
        finalized: state.binding.lifecycle_state === "rolled_back",
        request: existing,
        step: stepRows[0] || null,
        secrets_included: false,
      };
    }

    const rollbackSteps = state.steps.filter((step) => step.step_key === MANAGED_ROLLBACK_STEP_KEY);
    if (rollbackSteps.length > 1) {
      throw managedError(
        409,
        "managed_execution_rollback_step_ambiguous",
        "Managed execution has multiple rollback steps.",
      );
    }
    if (rollbackSteps.length === 1 && !["failed", "skipped"].includes(normalized(rollbackSteps[0].status))) {
      return {
        ok: true,
        reused: true,
        finalized: state.binding.lifecycle_state === "rolled_back",
        step: rollbackSteps[0],
        secrets_included: false,
      };
    }
    if (assignee) {
      await assertActiveAssignee({
        connection,
        tenantId: state.binding.tenant_id,
        assignedTo: assignee,
      });
    }
    await assertLiveAuthority(connection, state);

    const stepRunId = randomUUID();
    const requestId = randomUUID();
    await connection.query(
      `INSERT INTO step_runs
         (step_run_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
          actor_id, actor_type, brand_id, brand_key, request_id, session_id,
          conversation_id, correlation_id, execution_context_json,
          step_key, step_type, assigned_to, input_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'operator', ?, ?, ?, ?, ?, ?, ?, ?, 'managed_op', ?, ?)`,
      [
        stepRunId,
        runId,
        state.run.tenant_id,
        state.run.workspace_id || null,
        state.run.workspace_key || null,
        state.run.user_id || null,
        actorId || state.run.actor_id || state.run.user_id || null,
        state.run.brand_id || null,
        state.run.brand_key || null,
        state.run.request_id || null,
        state.run.session_id || null,
        state.run.conversation_id || null,
        state.run.correlation_id || runId,
        JSON.stringify({
          source: "managed_execution_lifecycle",
          contract: "tenant-managed-execution-v1",
          operation: "rollback",
          binding_id: state.binding.binding_id,
          authority_fingerprint_sha256: state.authority.fingerprint_sha256,
          secrets_included: false,
        }),
        MANAGED_ROLLBACK_STEP_KEY,
        assignee,
        JSON.stringify({ reason: normalizedReason, requested_by: actorId || null, secrets_included: false }),
      ],
    );
    await connection.query(
      `INSERT INTO managed_execution_step_requests
         (request_id, run_id, tenant_id, step_run_id, idempotency_key, step_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [requestId, runId, state.binding.tenant_id, stepRunId, key, MANAGED_ROLLBACK_STEP_KEY],
    );
    await connection.query(
      "UPDATE workflow_runs SET status = 'running', completed_at = NULL, error_json = NULL, started_at = COALESCE(started_at, NOW()) WHERE run_id = ?",
      [runId],
    );
    await connection.query(
      "UPDATE managed_execution_bindings SET lifecycle_state = 'rollback_executing', customer_status = 'in_progress' WHERE binding_id = ?",
      [state.binding.binding_id],
    );
    await connection.query(
      "UPDATE tickets SET lifecycle_state = 'rollback_executing', customer_status = 'in_progress', status = 'in_review', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
      [state.binding.task_ticket_id, state.binding.tenant_id],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_execution_rollback_requested",
      fromState: state.binding.lifecycle_state,
      toState: "rollback_executing",
      actorId,
      evidence: {
        step_run_id: stepRunId,
        idempotency_key_sha256: keyHash,
        assigned_to: assignee,
        reason: normalizedReason,
      },
    });
    return {
      ok: true,
      reused: false,
      finalized: false,
      run_id: runId,
      request: {
        request_id: requestId,
        run_id: runId,
        step_run_id: stepRunId,
        idempotency_key: key,
        step_key: MANAGED_ROLLBACK_STEP_KEY,
      },
      step: {
        step_run_id: stepRunId,
        run_id: runId,
        step_key: MANAGED_ROLLBACK_STEP_KEY,
        step_type: "managed_op",
        assigned_to: assignee,
        status: "pending",
      },
      lifecycle_state: "rollback_executing",
      customer_status: "in_progress",
      secrets_included: false,
    };
  });
}

export async function finalizeManagedExecutionRollback({
  pool,
  runId,
  stepRunId,
  actorId = null,
  evidence = null,
}) {
  assertManagedExecutionPayloadSecretFree(evidence, "rollback.evidence");

  return withManagedTransaction(pool, async (connection) => {
    const state = await loadManagedState(connection, runId);
    if (state.binding.lifecycle_state === "rolled_back") {
      return {
        ok: true,
        reused: true,
        run_id: runId,
        lifecycle_state: "rolled_back",
        customer_status: state.binding.customer_status,
        secrets_included: false,
      };
    }
    const step = findStep(state, stepRunId);
    if (step.step_key !== MANAGED_ROLLBACK_STEP_KEY || normalized(step.step_type) !== "managed_op") {
      throw managedError(
        409,
        "managed_execution_rollback_step_required",
        "Rollback finalization requires the managed rollback compensation step.",
      );
    }
    if (normalized(step.status) !== "completed") {
      throw managedError(
        409,
        "managed_execution_rollback_step_incomplete",
        "Rollback compensation step must be completed before finalization.",
      );
    }
    const otherActive = activeSteps(state, stepRunId);
    if (otherActive.length) {
      throw managedError(
        409,
        "managed_execution_rollback_other_steps_active",
        "Rollback finalization requires all other linked steps to be inactive.",
        { active_steps: otherActive.map((row) => row.step_run_id) },
      );
    }

    await connection.query(
      "UPDATE workflow_runs SET status = 'cancelled', completed_at = NOW() WHERE run_id = ?",
      [runId],
    );
    await connection.query(
      "UPDATE managed_execution_bindings SET lifecycle_state = 'rolled_back', customer_status = 'cancelled' WHERE binding_id = ?",
      [state.binding.binding_id],
    );
    await connection.query(
      "UPDATE tickets SET lifecycle_state = 'rolled_back', customer_status = 'cancelled', status = 'resolved', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?",
      [state.binding.task_ticket_id, state.binding.tenant_id],
    );
    await appendManagedEvent(connection, {
      bindingId: state.binding.binding_id,
      runId,
      tenantId: state.binding.tenant_id,
      eventType: "managed_execution_rollback_completed",
      fromState: state.binding.lifecycle_state,
      toState: "rolled_back",
      actorId,
      evidence: {
        step_run_id: stepRunId,
        compensation_evidence: evidence || null,
      },
    });
    return {
      ok: true,
      reused: false,
      run_id: runId,
      step_run_id: stepRunId,
      run_status: "cancelled",
      lifecycle_state: "rolled_back",
      customer_status: "cancelled",
      secrets_included: false,
    };
  });
}
