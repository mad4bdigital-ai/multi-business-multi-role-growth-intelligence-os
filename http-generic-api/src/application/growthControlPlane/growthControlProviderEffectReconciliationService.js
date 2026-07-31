import { randomUUID } from "node:crypto";

import {
  classifyGrowthControlProviderEffectReadback,
  compileGrowthControlRollbackContract,
} from "../../domain/growthControlPlane/growthControlProviderEffectReconciliation.js";

function reconciliationError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function resolveUnique(rows, code, message) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw reconciliationError(code, message, 409);
  const [candidate] = candidates;
  return candidate;
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.query !== "function") {
    throw reconciliationError("growth_control_reconciliation_pool_required", "pool.query is required.", 500);
  }
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

function stepBinding(receipt, step) {
  const input = parseJson(step.input_json, {});
  return {
    receipt_id: receipt.receipt_id,
    plan_id: receipt.plan_id,
    plan_step_id: receipt.plan_step_id,
    tenant_id: receipt.tenant_id,
    operation_key: receipt.operation_key,
    idempotency_key: receipt.idempotency_key,
    request_sha256: receipt.request_sha256,
    plan_hash_sha256: input.plan_hash_sha256,
    node_id: input.node_id ?? step.step_key,
    capability_key: input.capability_key ?? step.workflow_key ?? receipt.operation_key,
    action_ids: input.action_ids,
    resource_ids: input.resource_ids,
    environment: input.environment,
    effect_class: input.effect_class,
  };
}

function replayPayload(decision, rollbackContract) {
  const applied = decision.outcome === "confirmed_applied";
  return {
    ok: applied,
    reconciled: true,
    outcome: decision.outcome,
    reconciliation_sha256: decision.reconciliation_sha256,
    readback: {
      evidence_ref: decision.readback.evidence_ref,
      output_sha256: decision.readback.result_sha256 || decision.readback.provider_state_sha256,
      readback_sha256: decision.readback.readback_sha256,
    },
    retry_allowed: false,
    new_request_required: decision.new_request_required,
    rollback_required: decision.rollback_required,
    rollback_contract_sha256: rollbackContract?.rollback_request_sha256 || null,
    provider_dispatch_performed: false,
    external_writes: false,
    secrets_included: false,
  };
}

function stepError(decision, rollbackContract) {
  if (decision.outcome === "confirmed_not_applied") {
    return {
      code: "durable_execution_reconciled_no_effect",
      message: "Readback confirmed that the mutation did not take effect. A new governed request is required.",
      non_retryable: true,
      unknown_outcome: false,
      new_request_required: true,
      reconciliation_sha256: decision.reconciliation_sha256,
      evidence_ref: decision.readback.evidence_ref,
      secrets_included: false,
    };
  }
  if (decision.outcome === "partial_effect") {
    return {
      code: "durable_execution_partial_effect",
      message: "Readback confirmed a partial provider effect. Rollback or bounded manual repair is required.",
      non_retryable: true,
      unknown_outcome: false,
      rollback_required: true,
      reconciliation_sha256: decision.reconciliation_sha256,
      rollback_contract_sha256: rollbackContract?.rollback_request_sha256 || null,
      evidence_ref: decision.readback.evidence_ref,
      secrets_included: false,
    };
  }
  return {
    code: "durable_execution_readback_inconclusive",
    message: "Provider effect remains unknown. Additional governed readback is required before any new request.",
    non_retryable: true,
    unknown_outcome: true,
    reconciliation_sha256: decision.reconciliation_sha256,
    evidence_ref: decision.readback.evidence_ref,
    secrets_included: false,
  };
}

async function appendEvent(connection, {
  planId,
  planStepId,
  tenantId,
  eventType,
  actorId,
  evidence,
}) {
  await connection.query(
    `INSERT INTO execution_plan_events
      (plan_event_id, plan_id, plan_step_id, tenant_id, event_type, from_status, to_status, actor_id, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      planId,
      planStepId,
      tenantId,
      eventType,
      "blocked",
      eventType === "provider_effect_reconciled_applied" ? "completed" : "blocked",
      actorId,
      JSON.stringify({ ...evidence, secrets_included: false }),
    ],
  );
}

async function persistAppliedReconciliation(connection, receipt, step, decision, rollbackContract, actorId) {
  const replay = replayPayload(decision, rollbackContract);
  const [stepUpdate] = await connection.query(
    `UPDATE execution_plan_steps
        SET status = 'completed', output_json = ?, error_json = NULL, claim_token = NULL,
            completed_at = COALESCE(completed_at, NOW())
      WHERE plan_step_id = ? AND plan_id = ? AND tenant_id = ? AND status IN ('failed','blocked')`,
    [JSON.stringify(replay), step.plan_step_id, step.plan_id, step.tenant_id],
  );
  if (Number(stepUpdate?.affectedRows || 0) !== 1) {
    throw reconciliationError(
      "growth_control_reconciliation_step_race",
      "Execution step changed before applied readback could be recorded.",
      409,
    );
  }
  const [blockerRows] = await connection.query(
    `SELECT COUNT(*) AS blocker_count FROM execution_plan_steps
      WHERE plan_id = ? AND plan_step_id <> ? AND status IN ('failed','blocked')`,
    [step.plan_id, step.plan_step_id],
  );
  const blockerCount = Number(resolveUnique(
    blockerRows,
    "growth_control_reconciliation_blocker_count_ambiguous",
    "Execution blocker count resolved to multiple rows.",
  )?.blocker_count || 0);
  const planStatus = blockerCount === 0 ? "validated" : "blocked";
  await connection.query(
    "UPDATE execution_plans SET plan_status = ?, runtime_status = ? WHERE plan_id = ? AND tenant_id = ?",
    [planStatus === "blocked" ? "failed" : planStatus, planStatus, step.plan_id, step.tenant_id],
  );
  await appendEvent(connection, {
    planId: step.plan_id,
    planStepId: step.plan_step_id,
    tenantId: step.tenant_id,
    eventType: "provider_effect_reconciled_applied",
    actorId,
    evidence: {
      receipt_id: receipt.receipt_id,
      reconciliation_sha256: decision.reconciliation_sha256,
      evidence_ref: decision.readback.evidence_ref,
      plan_status: planStatus,
    },
  });
  return { step_status: "completed", plan_status: planStatus, replay };
}

async function persistBlockedReconciliation(connection, receipt, step, decision, rollbackContract, actorId) {
  const error = stepError(decision, rollbackContract);
  const [stepUpdate] = await connection.query(
    `UPDATE execution_plan_steps
        SET status = 'blocked', error_json = ?, claim_token = NULL
      WHERE plan_step_id = ? AND plan_id = ? AND tenant_id = ? AND status IN ('failed','blocked')`,
    [JSON.stringify(error), step.plan_step_id, step.plan_id, step.tenant_id],
  );
  if (Number(stepUpdate?.affectedRows || 0) !== 1) {
    throw reconciliationError(
      "growth_control_reconciliation_step_race",
      "Execution step changed before reconciliation evidence could be recorded.",
      409,
    );
  }
  await connection.query(
    "UPDATE execution_plans SET plan_status = 'failed', runtime_status = 'blocked' WHERE plan_id = ? AND tenant_id = ?",
    [step.plan_id, step.tenant_id],
  );
  const eventType = decision.outcome === "confirmed_not_applied"
    ? "provider_effect_reconciled_not_applied"
    : decision.outcome === "partial_effect"
      ? "provider_effect_reconciled_partial"
      : "provider_effect_reconciliation_inconclusive";
  await appendEvent(connection, {
    planId: step.plan_id,
    planStepId: step.plan_step_id,
    tenantId: step.tenant_id,
    eventType,
    actorId,
    evidence: {
      receipt_id: receipt.receipt_id,
      reconciliation_sha256: decision.reconciliation_sha256,
      evidence_ref: decision.readback.evidence_ref,
      rollback_contract_sha256: rollbackContract?.rollback_request_sha256 || null,
      new_request_required: decision.new_request_required,
      rollback_required: decision.rollback_required,
    },
  });
  return { step_status: "blocked", plan_status: "blocked", error };
}

export async function reconcileGrowthControlMutationReceipt({
  pool,
  receiptId,
  planId,
  planStepId,
  tenantId,
  readback,
  compensation = null,
  actorId = null,
} = {}) {
  return withTransaction(pool, async (connection) => {
    const [receiptRows] = await connection.query(
      `SELECT * FROM execution_plan_mutation_receipts
        WHERE receipt_id = ? AND plan_id = ? AND plan_step_id = ? AND tenant_id = ? LIMIT 2 FOR UPDATE`,
      [receiptId, planId, planStepId, tenantId],
    );
    const receipt = resolveUnique(
      receiptRows,
      "growth_control_reconciliation_receipt_ambiguous",
      "Mutation receipt identity resolved to multiple rows.",
    );
    if (!receipt) {
      throw reconciliationError("growth_control_reconciliation_receipt_not_found", "Mutation receipt was not found for the requested scope.", 404);
    }
    const [stepRows] = await connection.query(
      `SELECT * FROM execution_plan_steps
        WHERE plan_step_id = ? AND plan_id = ? AND tenant_id = ? LIMIT 2 FOR UPDATE`,
      [planStepId, planId, tenantId],
    );
    const step = resolveUnique(
      stepRows,
      "growth_control_reconciliation_step_ambiguous",
      "Execution step identity resolved to multiple rows.",
    );
    if (!step) {
      throw reconciliationError("growth_control_reconciliation_step_not_found", "Execution step was not found for the mutation receipt.", 404);
    }
    const decision = classifyGrowthControlProviderEffectReadback({
      receiptBinding: stepBinding(receipt, step),
      readback,
    });
    const rollbackContract = compensation
      ? compileGrowthControlRollbackContract({ reconciliation: decision, compensation })
      : null;

    if (receipt.dispatch_status === "reconciled") {
      const existing = parseJson(receipt.readback_json, {});
      if (existing.reconciliation_sha256 === decision.reconciliation_sha256) {
        return {
          ok: true,
          idempotent_replay: true,
          receipt_id: receipt.receipt_id,
          dispatch_status: "reconciled",
          reconciliation: existing,
          rollback_contract: rollbackContract,
          provider_dispatch_performed: false,
          external_writes: false,
          secrets_included: false,
        };
      }
      throw reconciliationError(
        "growth_control_reconciliation_conflict",
        "Mutation receipt was already reconciled with different readback evidence.",
        409,
      );
    }
    if (!["pending", "unknown_outcome"].includes(receipt.dispatch_status)) {
      throw reconciliationError(
        "growth_control_reconciliation_status_invalid",
        `Mutation receipt status '${receipt.dispatch_status}' cannot be reconciled.`,
        409,
      );
    }

    const receiptStatus = decision.receipt_transition;
    const replay = replayPayload(decision, rollbackContract);
    if (receiptStatus === "reconciled") {
      const [receiptUpdate] = await connection.query(
        `UPDATE execution_plan_mutation_receipts
            SET dispatch_status = 'reconciled', provider_receipt_json = ?, readback_json = ?,
                recovered_from_transport = 1, secrets_included = 0
          WHERE receipt_id = ? AND dispatch_status IN ('pending','unknown_outcome')`,
        [JSON.stringify(replay), JSON.stringify(decision), receipt.receipt_id],
      );
      if (Number(receiptUpdate?.affectedRows || 0) !== 1) {
        throw reconciliationError("growth_control_reconciliation_receipt_race", "Mutation receipt changed before reconciliation could be recorded.", 409);
      }
    } else {
      const [receiptUpdate] = await connection.query(
        `UPDATE execution_plan_mutation_receipts
            SET dispatch_status = 'unknown_outcome', readback_json = ?,
                recovered_from_transport = 1, secrets_included = 0
          WHERE receipt_id = ? AND dispatch_status IN ('pending','unknown_outcome')`,
        [JSON.stringify(decision), receipt.receipt_id],
      );
      if (Number(receiptUpdate?.affectedRows || 0) !== 1) {
        throw reconciliationError("growth_control_reconciliation_receipt_race", "Mutation receipt changed before readback evidence could be recorded.", 409);
      }
    }

    const lifecycle = decision.outcome === "confirmed_applied"
      ? await persistAppliedReconciliation(connection, receipt, step, decision, rollbackContract, actorId)
      : await persistBlockedReconciliation(connection, receipt, step, decision, rollbackContract, actorId);
    return {
      ok: true,
      idempotent_replay: false,
      receipt_id: receipt.receipt_id,
      dispatch_status: receiptStatus,
      reconciliation: decision,
      rollback_contract: rollbackContract,
      step_status: lifecycle.step_status,
      plan_status: lifecycle.plan_status,
      next_action: decision.step_disposition,
      retry_allowed: false,
      provider_call_made: false,
      provider_dispatch_performed: false,
      external_writes: false,
      secrets_included: false,
    };
  });
}

export async function readGrowthControlMutationReconciliation({
  pool,
  receiptId,
  planId,
  planStepId,
  tenantId,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw reconciliationError("growth_control_reconciliation_pool_required", "pool.query is required.", 500);
  }
  const [rows] = await pool.query(
    `SELECT receipt_id, plan_id, plan_step_id, tenant_id, operation_key, request_sha256,
            dispatch_status, provider_status, readback_json, recovered_from_transport, updated_at
       FROM execution_plan_mutation_receipts
      WHERE receipt_id = ? AND plan_id = ? AND plan_step_id = ? AND tenant_id = ? LIMIT 2`,
    [receiptId, planId, planStepId, tenantId],
  );
  const receipt = resolveUnique(
    rows,
    "growth_control_reconciliation_receipt_ambiguous",
    "Mutation receipt identity resolved to multiple rows.",
  );
  if (!receipt) return null;
  const reconciliation = parseJson(receipt.readback_json, null);
  return Object.freeze({
    receipt_id: receipt.receipt_id,
    plan_id: receipt.plan_id,
    plan_step_id: receipt.plan_step_id,
    tenant_id: receipt.tenant_id,
    operation_key: receipt.operation_key,
    request_sha256: receipt.request_sha256,
    dispatch_status: receipt.dispatch_status,
    provider_status: receipt.provider_status,
    recovered_from_transport: Boolean(receipt.recovered_from_transport),
    updated_at: receipt.updated_at || null,
    reconciliation,
    retry_allowed: false,
    provider_call_made: false,
    provider_dispatch_performed: false,
    external_writes: false,
    secrets_included: false,
  });
}

export const growthControlProviderEffectReconciliationServiceContract = Object.freeze({
  version: "growth-control-provider-effect-reconciliation-service-v1",
  receipt_authority: "execution_plan_mutation_receipts",
  step_authority: "execution_plan_steps",
  event_authority: "execution_plan_events",
  eligible_receipt_statuses: ["pending", "unknown_outcome"],
  conclusive_receipt_status: "reconciled",
  inconclusive_receipt_status: "unknown_outcome",
  applied_step_disposition: "completed",
  non_applied_step_disposition: "blocked",
  partial_step_disposition: "blocked",
  unknown_step_disposition: "blocked",
  blind_retry_allowed: false,
  automatic_retry_allowed: false,
  automatic_rollback_allowed: false,
  provider_call_made: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderEffectReconciliationService = Object.freeze({
  parseJson,
  resolveUnique,
  stepBinding,
  replayPayload,
  stepError,
  withTransaction,
});
