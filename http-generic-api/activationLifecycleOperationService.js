import {
  appendActivationEvidenceItem,
  appendActivationReconciliationAttempt,
  appendActivationStageAttempt,
  completeActivationReconciliationAttempt,
  readActivationOperationProjection,
  updateActivationOperationProjection,
} from "./activationOperationProjectionRepository.js";
import {
  assertActivationOperationTransition,
  assertActivationStageAttemptTransition,
} from "./activationLifecycleStateMachine.js";
import {
  authorizeActivationRetryRequest,
  resolveActivationReconciliationOutcome,
} from "./activationRetryReconciliationPolicy.js";

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeText(value, field, max, { required = true } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) fail(`activation_${field}_required`, `${field} is required.`);
    return null;
  }
  if (normalized.length > max) {
    fail(`activation_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function normalizeVersion(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(
      "activation_expected_version_invalid",
      "expected_version must be a non-negative integer.",
    );
  }
  return normalized;
}

function normalizeSubject(subject = {}) {
  const isAdmin = subject.is_admin === true;
  const tenantId = normalizeText(subject.tenant_id, "tenant_id", 36);
  const userId = normalizeText(subject.user_id, "user_id", 128, { required: !isAdmin });
  return {
    tenant_id: tenantId,
    user_id: userId,
    is_admin: isAdmin,
  };
}

async function executeIdempotentStateTransition(
  pool,
  {
    update_sql,
    update_params,
    read_sql,
    read_params,
    state_field,
    target_state,
    conflict_code,
    conflict_message,
  },
) {
  const [result] = await pool.query(update_sql, update_params);
  if (Number(result?.affectedRows || 0) === 1) {
    return { updated: true, idempotent: false, state: target_state };
  }
  const [rows] = await pool.query(read_sql, read_params);
  if (rows?.[0]?.[state_field] === target_state) {
    return { updated: false, idempotent: true, state: target_state };
  }
  fail(conflict_code, conflict_message, 409);
}

const defaultRepository = Object.freeze({
  readOperation: readActivationOperationProjection,
  updateOperation: updateActivationOperationProjection,
  appendStageAttempt: appendActivationStageAttempt,
  appendEvidence: appendActivationEvidenceItem,
  appendReconciliation: appendActivationReconciliationAttempt,
  completeReconciliation: completeActivationReconciliationAttempt,

  async nextStageAttemptNumber(pool, { operation_id, tenant_id, stage_key }) {
    const [rows] = await pool.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM activation_stage_attempts
        WHERE operation_id = ?
          AND tenant_id = ?
          AND stage_key = ?`,
      [operation_id, tenant_id, stage_key],
    );
    return Number(rows?.[0]?.next_attempt_number || 1);
  },

  async readStageAttempt(pool, { attempt_id, operation_id, tenant_id }) {
    const [rows] = await pool.query(
      `SELECT attempt_id, operation_id, tenant_id, stage_key, attempt_number,
              source_type, attempt_status, retryable, unknown_outcome,
              error_code, evidence_ref, started_at, completed_at
         FROM activation_stage_attempts
        WHERE attempt_id = ?
          AND operation_id = ?
          AND tenant_id = ?
        LIMIT 1`,
      [attempt_id, operation_id, tenant_id],
    );
    return rows?.[0] || null;
  },

  async transitionStageAttempt(
    pool,
    {
      attempt_id,
      operation_id,
      tenant_id,
      from_status,
      to_status,
      retryable = false,
      unknown_outcome = false,
      error_code = null,
      error_message = null,
      evidence_ref = null,
    },
  ) {
    return executeIdempotentStateTransition(pool, {
      update_sql: `UPDATE activation_stage_attempts
                      SET attempt_status = ?,
                          retryable = ?,
                          unknown_outcome = ?,
                          error_code = ?,
                          error_message = ?,
                          evidence_ref = ?,
                          completed_at = CASE
                            WHEN ? IN ('succeeded','degraded','failed','unknown_outcome','cancelled')
                              THEN COALESCE(completed_at, UTC_TIMESTAMP(3))
                            ELSE completed_at
                          END
                    WHERE attempt_id = ?
                      AND operation_id = ?
                      AND tenant_id = ?
                      AND attempt_status = ?`,
      update_params: [
        to_status,
        retryable === true ? 1 : 0,
        unknown_outcome === true ? 1 : 0,
        error_code,
        error_message,
        evidence_ref,
        to_status,
        attempt_id,
        operation_id,
        tenant_id,
        from_status,
      ],
      read_sql: `SELECT attempt_status
                   FROM activation_stage_attempts
                  WHERE attempt_id = ?
                    AND operation_id = ?
                    AND tenant_id = ?
                  LIMIT 1`,
      read_params: [attempt_id, operation_id, tenant_id],
      state_field: "attempt_status",
      target_state: to_status,
      conflict_code: "activation_stage_attempt_transition_conflict",
      conflict_message:
        "The stage attempt changed or is outside the authorized tenant and operation scope.",
    });
  },

  async nextReconciliationAttemptNumber(pool, { operation_id, tenant_id }) {
    const [rows] = await pool.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM activation_reconciliation_attempts
        WHERE operation_id = ?
          AND tenant_id = ?`,
      [operation_id, tenant_id],
    );
    return Number(rows?.[0]?.next_attempt_number || 1);
  },

  async hasSameOperationEvidence(pool, { operation_id, tenant_id }) {
    const [rows] = await pool.query(
      `SELECT evidence_id
         FROM activation_evidence_items
        WHERE operation_id = ?
          AND tenant_id = ?
          AND secrets_included = 0
          AND redaction_state IN ('sanitized','reference_only')
        LIMIT 1`,
      [operation_id, tenant_id],
    );
    return Boolean(rows?.[0]?.evidence_id);
  },
});

async function withActivationTransaction(pool, work) {
  if (!pool || typeof pool.getConnection !== "function") {
    fail(
      "activation_transaction_pool_required",
      "Activation lifecycle mutations require a transaction-capable database pool.",
      500,
    );
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function requireOperation(repository, connection, subject, operationId) {
  const operation = await repository.readOperation(connection, {
    operation_id: operationId,
    ...subject,
  });
  if (!operation) {
    fail(
      "activation_operation_not_found",
      "Activation operation was not found in the authorized subject scope.",
      404,
    );
  }
  return operation;
}

async function appendEvidenceIfPresent(
  repository,
  connection,
  subject,
  operationId,
  evidence,
) {
  if (!evidence) return null;
  return repository.appendEvidence(connection, {
    ...evidence,
    operation_id: operationId,
    tenant_id: subject.tenant_id,
  });
}

export function createActivationLifecycleOperationService({
  repository = defaultRepository,
} = {}) {
  for (const method of [
    "readOperation",
    "updateOperation",
    "appendStageAttempt",
    "appendEvidence",
    "appendReconciliation",
    "completeReconciliation",
    "nextStageAttemptNumber",
    "readStageAttempt",
    "transitionStageAttempt",
    "nextReconciliationAttemptNumber",
    "hasSameOperationEvidence",
  ]) {
    if (typeof repository?.[method] !== "function") {
      fail(
        "activation_lifecycle_repository_invalid",
        `Activation lifecycle repository method ${method} is required.`,
        500,
      );
    }
  }

  return Object.freeze({
    async transitionOperation({
      pool,
      subject: rawSubject,
      operation_id,
      expected_version,
      to_status,
      current_stage = null,
      evidence = null,
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const expectedVersion = normalizeVersion(expected_version);
      const toStatus = normalizeText(to_status, "to_status", 64);

      return withActivationTransaction(pool, async (connection) => {
        const operation = await requireOperation(
          repository,
          connection,
          subject,
          operationId,
        );
        if (Number(operation.optimistic_version) !== expectedVersion) {
          fail(
            "activation_operation_version_conflict",
            "The Activation operation changed before the lifecycle transition.",
            409,
          );
        }
        assertActivationOperationTransition(operation.operation_status, toStatus);
        await appendEvidenceIfPresent(
          repository,
          connection,
          subject,
          operationId,
          evidence,
        );
        if (
          toStatus === "active" &&
          !(await repository.hasSameOperationEvidence(connection, {
            operation_id: operationId,
            tenant_id: subject.tenant_id,
          }))
        ) {
          fail(
            "activation_same_operation_evidence_required",
            "Active classification requires bounded evidence from the same operation.",
            409,
          );
        }
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...subject,
          expected_version: expectedVersion,
          patch: {
            operation_status: toStatus,
            ...(current_stage
              ? { current_stage: normalizeText(current_stage, "current_stage", 80) }
              : {}),
          },
        });
        return {
          operation_id: operationId,
          from_status: operation.operation_status,
          to_status: toStatus,
          optimistic_version: update.optimistic_version,
          evidence_verified: toStatus === "active" ? true : undefined,
          secrets_included: false,
        };
      });
    },

    async startStageAttempt({
      pool,
      subject: rawSubject,
      operation_id,
      stage_key,
      source_type = "platform_native",
      operation_target_status = null,
      expected_version = null,
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const stageKey = normalizeText(stage_key, "stage_key", 80);

      return withActivationTransaction(pool, async (connection) => {
        const operation = await requireOperation(
          repository,
          connection,
          subject,
          operationId,
        );
        let expectedVersion = null;
        if (operation_target_status) {
          expectedVersion = normalizeVersion(expected_version);
          if (Number(operation.optimistic_version) !== expectedVersion) {
            fail(
              "activation_operation_version_conflict",
              "The Activation operation changed before the stage attempt started.",
              409,
            );
          }
          assertActivationOperationTransition(
            operation.operation_status,
            operation_target_status,
          );
        }

        const attemptNumber = await repository.nextStageAttemptNumber(connection, {
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          stage_key: stageKey,
        });
        const inserted = await repository.appendStageAttempt(connection, {
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          stage_key: stageKey,
          attempt_number: attemptNumber,
          source_type,
          attempt_status: "pending",
        });
        assertActivationStageAttemptTransition("pending", "running");
        await repository.transitionStageAttempt(connection, {
          attempt_id: inserted.attempt_id,
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          from_status: "pending",
          to_status: "running",
        });

        let nextVersion = Number(operation.optimistic_version);
        if (operation_target_status) {
          const update = await repository.updateOperation(connection, {
            operation_id: operationId,
            ...subject,
            expected_version: expectedVersion,
            patch: {
              operation_status: operation_target_status,
              current_stage: stageKey,
            },
          });
          nextVersion = update.optimistic_version;
        }
        return {
          operation_id: operationId,
          attempt_id: inserted.attempt_id,
          attempt_number: attemptNumber,
          stage_key: stageKey,
          attempt_status: "running",
          operation_status:
            operation_target_status || operation.operation_status,
          optimistic_version: nextVersion,
          secrets_included: false,
        };
      });
    },

    async completeStageAttempt({
      pool,
      subject: rawSubject,
      operation_id,
      attempt_id,
      to_status,
      retryable = false,
      error_code = null,
      error_message = null,
      evidence = null,
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const attemptId = normalizeText(attempt_id, "attempt_id", 36);
      const toStatus = normalizeText(to_status, "stage_attempt_to_status", 64);

      return withActivationTransaction(pool, async (connection) => {
        await requireOperation(repository, connection, subject, operationId);
        const attempt = await repository.readStageAttempt(connection, {
          attempt_id: attemptId,
          operation_id: operationId,
          tenant_id: subject.tenant_id,
        });
        if (!attempt) {
          fail(
            "activation_stage_attempt_not_found",
            "Activation stage attempt was not found in the authorized operation scope.",
            404,
          );
        }
        assertActivationStageAttemptTransition(attempt.attempt_status, toStatus);
        const evidenceRecord = await appendEvidenceIfPresent(
          repository,
          connection,
          subject,
          operationId,
          evidence ? { ...evidence, attempt_id: attemptId } : null,
        );
        const transition = await repository.transitionStageAttempt(connection, {
          attempt_id: attemptId,
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          from_status: attempt.attempt_status,
          to_status: toStatus,
          retryable,
          unknown_outcome: toStatus === "unknown_outcome",
          error_code,
          error_message,
          evidence_ref: evidenceRecord?.evidence_id || null,
        });
        return {
          operation_id: operationId,
          attempt_id: attemptId,
          from_status: attempt.attempt_status,
          to_status: toStatus,
          idempotent: transition.idempotent === true,
          evidence_id: evidenceRecord?.evidence_id || null,
          secrets_included: false,
        };
      });
    },

    async scheduleRetry({
      pool,
      subject: rawSubject,
      operation_id,
      expected_version,
      target_status,
      governed_retry_approved,
      approval_ref,
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const expectedVersion = normalizeVersion(expected_version);

      return withActivationTransaction(pool, async (connection) => {
        const operation = await requireOperation(
          repository,
          connection,
          subject,
          operationId,
        );
        if (Number(operation.optimistic_version) !== expectedVersion) {
          fail(
            "activation_operation_version_conflict",
            "The Activation operation changed before retry scheduling.",
            409,
          );
        }
        const decision = authorizeActivationRetryRequest({
          operation_status: operation.operation_status,
          target_status,
          governed_retry_approved,
          approval_ref,
        });
        const authorizationEvidence = await repository.appendEvidence(connection, {
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          evidence_type: "governed_retry_authorization",
          source_type: "governance_registry",
          source_ref: decision.approval_ref,
          evidence: {
            source_status: decision.source_status,
            scheduled_status: decision.scheduled_status,
            target_status: decision.target_status,
            blind_replay_allowed: false,
          },
        });
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...subject,
          expected_version: expectedVersion,
          patch: { operation_status: "retry_scheduled" },
        });
        return {
          operation_id: operationId,
          ...decision,
          authorization_evidence_id: authorizationEvidence.evidence_id,
          optimistic_version: update.optimistic_version,
          secrets_included: false,
        };
      });
    },

    async beginReconciliation({
      pool,
      subject: rawSubject,
      operation_id,
      expected_version,
      reason_code = "unknown_outcome",
      source_type = "platform_native",
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const expectedVersion = normalizeVersion(expected_version);

      return withActivationTransaction(pool, async (connection) => {
        const operation = await requireOperation(
          repository,
          connection,
          subject,
          operationId,
        );
        if (Number(operation.optimistic_version) !== expectedVersion) {
          fail(
            "activation_operation_version_conflict",
            "The Activation operation changed before reconciliation started.",
            409,
          );
        }
        assertActivationOperationTransition(operation.operation_status, "reconciling");
        const attemptNumber = await repository.nextReconciliationAttemptNumber(
          connection,
          {
            operation_id: operationId,
            tenant_id: subject.tenant_id,
          },
        );
        const reconciliation = await repository.appendReconciliation(connection, {
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          attempt_number: attemptNumber,
          reason_code,
          source_type,
          reconciliation_status: "pending",
        });
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...subject,
          expected_version: expectedVersion,
          patch: { operation_status: "reconciling" },
        });
        return {
          operation_id: operationId,
          reconciliation_id: reconciliation.reconciliation_id,
          attempt_number: attemptNumber,
          operation_status: "reconciling",
          optimistic_version: update.optimistic_version,
          secrets_included: false,
        };
      });
    },

    async completeReconciliation({
      pool,
      subject: rawSubject,
      operation_id,
      reconciliation_id,
      expected_version,
      outcome,
      evidence = null,
    } = {}) {
      const subject = normalizeSubject(rawSubject);
      const operationId = normalizeText(operation_id, "operation_id", 36);
      const reconciliationId = normalizeText(
        reconciliation_id,
        "reconciliation_id",
        36,
      );
      const expectedVersion = normalizeVersion(expected_version);

      return withActivationTransaction(pool, async (connection) => {
        const operation = await requireOperation(
          repository,
          connection,
          subject,
          operationId,
        );
        if (Number(operation.optimistic_version) !== expectedVersion) {
          fail(
            "activation_operation_version_conflict",
            "The Activation operation changed before reconciliation completion.",
            409,
          );
        }
        if (operation.operation_status !== "reconciling") {
          fail(
            "activation_reconciliation_operation_state_invalid",
            "Reconciliation can complete only while the operation is reconciling.",
            409,
          );
        }

        const evidenceRecord = await appendEvidenceIfPresent(
          repository,
          connection,
          subject,
          operationId,
          evidence,
        );
        const decision = resolveActivationReconciliationOutcome({
          outcome,
          operation_id: operationId,
          evidence_operation_id: evidenceRecord ? operationId : null,
          evidence_verified: Boolean(evidenceRecord),
        });
        assertActivationOperationTransition(
          operation.operation_status,
          decision.operation_status,
        );
        await repository.completeReconciliation(connection, {
          reconciliation_id: reconciliationId,
          operation_id: operationId,
          tenant_id: subject.tenant_id,
          from_status: "pending",
          to_status: decision.outcome,
          outcome_code: decision.outcome,
          evidence_ref: evidenceRecord?.evidence_id || null,
        });
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...subject,
          expected_version: expectedVersion,
          patch: { operation_status: decision.operation_status },
        });
        return {
          operation_id: operationId,
          reconciliation_id: reconciliationId,
          evidence_id: evidenceRecord?.evidence_id || null,
          ...decision,
          optimistic_version: update.optimistic_version,
          secrets_included: false,
        };
      });
    },
  });
}

export const activationLifecycleOperationService =
  createActivationLifecycleOperationService();
