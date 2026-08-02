import { randomUUID } from "node:crypto";
import {
  assertManagedExecutionPayloadSecretFree,
  assertManagedExecutionTransition,
  managedError,
  parseJson,
  sha256Json,
} from "./managedExecutionCore.js";
import { assertManagedExecutionAuthorityStillEffective } from "./managedExecutionAuthority.js";
import { appendManagedEvent, withManagedTransaction } from "./managedExecutionPersistence.js";

function assertSnapshotFingerprint(authoritySnapshot) {
  const { fingerprint_sha256: fingerprint, ...authorityPayload } = authoritySnapshot || {};
  if (!fingerprint || sha256Json(authorityPayload) !== fingerprint) throw managedError(409, "managed_execution_authority_snapshot_tampered", "Managed execution authority snapshot fingerprint does not match its payload.");
  return authoritySnapshot;
}

export async function decideManagedExecutionApproval({ pool, connection: suppliedConnection = null, holdId, decision, decisionBy, decisionNote = null }) {
  const operation = async (connection) => {
    const [holdRows] = await connection.query("SELECT * FROM approval_holds WHERE hold_id = ? LIMIT 2 FOR UPDATE", [holdId]);
    if (holdRows.length !== 1) throw managedError(404, "managed_execution_hold_not_found", "Managed execution approval hold was not found.");
    const hold = holdRows[0];
    const context = parseJson(hold.execution_context_json, {});
    if (context.source !== "managed_execution_lifecycle") throw managedError(409, "managed_execution_hold_contract_mismatch", "Approval hold is not owned by managed execution lifecycle.");
    if (hold.status !== "open") throw managedError(409, "managed_execution_hold_already_decided", `Hold is already '${hold.status}'.`);
    const [bindingRows] = await connection.query("SELECT * FROM managed_execution_bindings WHERE run_id = ? LIMIT 2 FOR UPDATE", [hold.run_id]);
    if (bindingRows.length !== 1) throw managedError(409, "managed_execution_binding_missing", "Managed execution binding is missing or ambiguous.");
    const binding = bindingRows[0];

    if (hold.expires_at && new Date(hold.expires_at).getTime() <= Date.now()) {
      await connection.query("UPDATE approval_holds SET status = 'expired', decided_at = NOW() WHERE hold_id = ? AND status = 'open'", [holdId]);
      await connection.query("UPDATE workflow_runs SET status = 'awaiting_approval', completed_at = NULL WHERE run_id = ?", [hold.run_id]);
      await connection.query("UPDATE managed_execution_bindings SET lifecycle_state = 'approval_expired', customer_status = 'needs_your_input' WHERE binding_id = ?", [binding.binding_id]);
      await connection.query("UPDATE tickets SET lifecycle_state = 'approval_expired', customer_status = 'needs_your_input', status = 'awaiting_approval', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?", [binding.task_ticket_id, binding.tenant_id]);
      await appendManagedEvent(connection, { bindingId: binding.binding_id, runId: hold.run_id, tenantId: binding.tenant_id, eventType: "approval_expired", fromState: binding.lifecycle_state, toState: "approval_expired", actorId: decisionBy, evidence: { hold_id: holdId } });
      return { ok: false, status_code: 409, error: { code: "managed_execution_approval_expired", message: "Managed execution approval has expired." }, hold_id: holdId, run_id: hold.run_id, run_status: "awaiting_approval", lifecycle_state: "approval_expired", customer_status: "needs_your_input", secrets_included: false };
    }
    if (!["approved", "rejected", "escalated"].includes(decision)) throw managedError(400, "managed_execution_decision_invalid", "decision must be approved, rejected, or escalated.");

    if (decision === "approved") {
      const [runRows] = await connection.query("SELECT execution_context_json FROM workflow_runs WHERE run_id = ? LIMIT 2 FOR UPDATE", [hold.run_id]);
      if (runRows.length !== 1) throw managedError(409, "managed_execution_run_missing", "Managed execution run is missing or ambiguous.");
      const authoritySnapshot = assertSnapshotFingerprint(parseJson(runRows[0].execution_context_json, {}).authority_snapshot || {});
      await assertManagedExecutionAuthorityStillEffective({ connection, authoritySnapshot });
    }

    const actor = String(decisionBy || "system").slice(0, 36);
    if (decision === "escalated") {
      const escalatedHoldId = randomUUID();
      await connection.query("UPDATE approval_holds SET status = 'escalated', decision_by = ?, decision_note = ?, decided_at = NOW() WHERE hold_id = ? AND status = 'open'", [actor, decisionNote, holdId]);
      await connection.query(
        `INSERT INTO approval_holds
           (hold_id, run_id, tenant_id, workspace_id, workspace_key, requested_by, user_id,
            actor_id, actor_type, brand_id, brand_key, request_id, session_id, conversation_id,
            correlation_id, execution_context_json, hold_type, required_role, status, expires_at)
         SELECT ?, run_id, tenant_id, workspace_id, workspace_key, requested_by, user_id,
                actor_id, actor_type, brand_id, brand_key, request_id, session_id, conversation_id,
                correlation_id, JSON_SET(COALESCE(execution_context_json, JSON_OBJECT()), '$.escalated_from_hold_id', ?),
                'supervisor_approval', 'supervisor', 'open', DATE_ADD(NOW(), INTERVAL 24 HOUR)
           FROM approval_holds WHERE hold_id = ?`,
        [escalatedHoldId, holdId, holdId],
      );
      await connection.query("UPDATE workflow_runs SET status = 'awaiting_approval' WHERE run_id = ?", [hold.run_id]);
      await connection.query("UPDATE managed_execution_bindings SET lifecycle_state = 'escalated', customer_status = 'waiting_for_approval', approval_hold_id = ? WHERE binding_id = ?", [escalatedHoldId, binding.binding_id]);
      await connection.query("UPDATE tickets SET lifecycle_state = 'escalated', customer_status = 'waiting_for_approval', status = 'awaiting_approval', updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?", [binding.task_ticket_id, binding.tenant_id]);
      await appendManagedEvent(connection, { bindingId: binding.binding_id, runId: hold.run_id, tenantId: binding.tenant_id, eventType: "approval_escalated", fromState: binding.lifecycle_state, toState: "escalated", actorId: actor, evidence: { hold_id: holdId, escalated_hold_id: escalatedHoldId } });
      return { ok: true, hold_id: holdId, decision, escalated_hold_id: escalatedHoldId, run_id: hold.run_id, run_status: "awaiting_approval", lifecycle_state: "escalated", customer_status: "waiting_for_approval", secrets_included: false };
    }

    const runStatus = decision === "approved" ? "running" : "failed";
    const lifecycleState = decision === "approved" ? "executing" : "approval_rejected";
    const customerStatus = decision === "approved" ? "in_progress" : "failed";
    await connection.query("UPDATE approval_holds SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW() WHERE hold_id = ? AND status = 'open'", [decision, actor, decisionNote, holdId]);
    await connection.query(
      `UPDATE workflow_runs SET status = ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
       completed_at = CASE WHEN ? = 'failed' THEN NOW() ELSE completed_at END WHERE run_id = ?`,
      [runStatus, runStatus, runStatus, hold.run_id],
    );
    await connection.query("UPDATE managed_execution_bindings SET lifecycle_state = ?, customer_status = ? WHERE binding_id = ?", [lifecycleState, customerStatus, binding.binding_id]);
    await connection.query("UPDATE tickets SET lifecycle_state = ?, customer_status = ?, status = CASE WHEN ? = 'failed' THEN 'resolved' ELSE 'in_review' END, updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?", [lifecycleState, customerStatus, runStatus, binding.task_ticket_id, binding.tenant_id]);
    await appendManagedEvent(connection, { bindingId: binding.binding_id, runId: hold.run_id, tenantId: binding.tenant_id, eventType: `approval_${decision}`, fromState: binding.lifecycle_state, toState: lifecycleState, actorId: actor, evidence: { hold_id: holdId } });
    return { ok: true, hold_id: holdId, decision, run_id: hold.run_id, run_status: runStatus, lifecycle_state: lifecycleState, customer_status: customerStatus, secrets_included: false };
  };
  return suppliedConnection ? operation(suppliedConnection) : withManagedTransaction(pool, operation);
}

export async function syncManagedExecutionRunStatus({ pool, runId, nextStatus, actorId = null, output = null, error = null }) {
  assertManagedExecutionPayloadSecretFree(output, "run.output");
  assertManagedExecutionPayloadSecretFree(error, "run.error");
  return withManagedTransaction(pool, async (connection) => {
    const [runRows] = await connection.query("SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 2 FOR UPDATE", [runId]);
    if (runRows.length !== 1) throw managedError(404, "managed_execution_run_not_found", "Managed execution run was not found.");
    const run = runRows[0];
    const context = parseJson(run.execution_context_json, {});
    if (context.contract !== "tenant-managed-execution-v1") throw managedError(409, "managed_execution_run_contract_mismatch", "Run is not owned by managed execution lifecycle.");
    assertManagedExecutionTransition({ current_status: run.status, next_status: nextStatus });
    const [bindingRows] = await connection.query("SELECT * FROM managed_execution_bindings WHERE run_id = ? LIMIT 2 FOR UPDATE", [runId]);
    if (bindingRows.length !== 1) throw managedError(409, "managed_execution_binding_missing", "Managed execution binding is missing or ambiguous.");
    const binding = bindingRows[0];
    if (run.status === nextStatus) return { ok: true, reused: true, run_id: runId, status: run.status, lifecycle_state: binding.lifecycle_state, customer_status: binding.customer_status, secrets_included: false };

    if (nextStatus === "running") {
      const [holds] = await connection.query("SELECT status, expires_at FROM approval_holds WHERE run_id = ? ORDER BY id FOR UPDATE", [runId]);
      const openHold = holds.find((hold) => hold.status === "open");
      if (openHold) {
        if (openHold.expires_at && new Date(openHold.expires_at).getTime() <= Date.now()) throw managedError(409, "managed_execution_approval_expired", "Managed execution approval has expired.");
        throw managedError(409, "managed_execution_approval_pending", "Managed execution is still awaiting approval.");
      }
      if (context.authority_snapshot?.approval?.required && !holds.some((hold) => hold.status === "approved")) throw managedError(409, "managed_execution_approval_evidence_missing", "Managed execution requires an approved hold before running.");
      const authoritySnapshot = assertSnapshotFingerprint(context.authority_snapshot || {});
      await assertManagedExecutionAuthorityStillEffective({ connection, authoritySnapshot });
    }

    if (["completed", "failed", "cancelled"].includes(nextStatus)) {
      const [activeStepRows] = await connection.query(
        "SELECT step_run_id, status FROM step_runs WHERE run_id = ? AND status IN ('pending','running','awaiting') ORDER BY id LIMIT 20 FOR UPDATE",
        [runId],
      );
      if (activeStepRows.length) throw managedError(409, "managed_execution_terminal_steps_active", "Managed execution cannot enter a terminal state while linked steps remain active.", { active_steps: activeStepRows });
      if (nextStatus === "completed") {
        const [failedStepRows] = await connection.query(
          "SELECT step_run_id, status FROM step_runs WHERE run_id = ? AND status = 'failed' ORDER BY id LIMIT 20 FOR UPDATE",
          [runId],
        );
        if (failedStepRows.length) throw managedError(409, "managed_execution_completion_has_failed_steps", "Managed execution cannot complete while linked steps are failed.", { failed_steps: failedStepRows });
      }
    }

    await connection.query(
      `UPDATE workflow_runs SET status = ?, output_json = COALESCE(?, output_json), error_json = COALESCE(?, error_json),
       started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
       completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END
       WHERE run_id = ?`,
      [nextStatus, output === null ? null : JSON.stringify(output), error === null ? null : JSON.stringify(error), nextStatus, nextStatus, runId],
    );
    const lifecycleState = nextStatus === "completed" ? "verified" : nextStatus === "failed" ? "failed" : nextStatus === "cancelled" ? "cancelled" : nextStatus === "paused" ? "blocked" : "executing";
    const customerStatus = nextStatus === "completed" ? "completed" : nextStatus === "failed" ? "failed" : nextStatus === "cancelled" ? "cancelled" : nextStatus === "paused" ? "blocked" : "in_progress";
    await connection.query("UPDATE managed_execution_bindings SET lifecycle_state = ?, customer_status = ? WHERE binding_id = ?", [lifecycleState, customerStatus, binding.binding_id]);
    await connection.query("UPDATE tickets SET lifecycle_state = ?, customer_status = ?, status = CASE WHEN ? IN ('completed','failed','cancelled') THEN 'resolved' ELSE 'in_review' END, updated_at = NOW() WHERE ticket_id = ? AND tenant_id = ?", [lifecycleState, customerStatus, nextStatus, binding.task_ticket_id, binding.tenant_id]);
    await appendManagedEvent(connection, { bindingId: binding.binding_id, runId, tenantId: binding.tenant_id, eventType: "run_status_changed", fromState: binding.lifecycle_state, toState: lifecycleState, actorId, evidence: { run_status: nextStatus } });
    return { ok: true, reused: false, run_id: runId, status: nextStatus, lifecycle_state: lifecycleState, customer_status: customerStatus, secrets_included: false };
  });
}
