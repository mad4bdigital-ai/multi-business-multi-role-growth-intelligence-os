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
  classifyActivationOperationState,
} from "./activationLifecycleStateMachine.js";
import {
  ACTIVATION_SUCCESS_EVIDENCE_TYPES,
  assertActivationSuccessEvidenceType,
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

function text(value, field, max, required = true) {
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

function version(value) {
  if (value === null || value === undefined || value === "") {
    fail("activation_expected_version_required", "expected_version is required.");
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(
      "activation_expected_version_invalid",
      "expected_version must be a non-negative integer.",
    );
  }
  return normalized;
}

function subject(value = {}) {
  const isAdmin = value.is_admin === true;
  return {
    tenant_id: text(value.tenant_id, "tenant_id", 36),
    user_id: text(value.user_id, "user_id", 128, !isAdmin),
    is_admin: isAdmin,
  };
}

async function idempotentTransition(pool, config) {
  const [result] = await pool.query(config.update_sql, config.update_params);
  if (Number(result?.affectedRows || 0) === 1) {
    return { updated: true, idempotent: false, state: config.target_state };
  }
  const [rows] = await pool.query(config.read_sql, config.read_params);
  if (rows?.[0]?.[config.state_field] === config.target_state) {
    return { updated: false, idempotent: true, state: config.target_state };
  }
  fail(config.conflict_code, config.conflict_message, 409);
}

const defaultRepository = Object.freeze({
  readOperation: readActivationOperationProjection,
  updateOperation: updateActivationOperationProjection,
  appendStageAttempt: appendActivationStageAttempt,
  appendEvidence: appendActivationEvidenceItem,
  appendReconciliation: appendActivationReconciliationAttempt,
  completeReconciliation: completeActivationReconciliationAttempt,

  async nextStageAttemptNumber(pool, input) {
    const [rows] = await pool.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM activation_stage_attempts
        WHERE operation_id = ? AND tenant_id = ? AND stage_key = ?`,
      [input.operation_id, input.tenant_id, input.stage_key],
    );
    return Number(rows?.[0]?.next_attempt_number || 1);
  },

  async readStageAttempt(pool, input) {
    const [rows] = await pool.query(
      `SELECT attempt_id, operation_id, tenant_id, stage_key, attempt_number,
              source_type, attempt_status, retryable, unknown_outcome,
              error_code, evidence_ref, started_at, completed_at
         FROM activation_stage_attempts
        WHERE attempt_id = ? AND operation_id = ? AND tenant_id = ?
        LIMIT 1`,
      [input.attempt_id, input.operation_id, input.tenant_id],
    );
    return rows?.[0] || null;
  },

  async transitionStageAttempt(pool, input) {
    return idempotentTransition(pool, {
      update_sql: `UPDATE activation_stage_attempts
                      SET attempt_status = ?, retryable = ?, unknown_outcome = ?,
                          error_code = ?, error_message = ?, evidence_ref = ?,
                          completed_at = CASE
                            WHEN ? IN ('succeeded','degraded','failed','unknown_outcome','cancelled')
                              THEN COALESCE(completed_at, UTC_TIMESTAMP(3))
                            ELSE completed_at
                          END
                    WHERE attempt_id = ? AND operation_id = ? AND tenant_id = ?
                      AND attempt_status = ?`,
      update_params: [
        input.to_status,
        input.retryable === true ? 1 : 0,
        input.unknown_outcome === true ? 1 : 0,
        input.error_code || null,
        input.error_message || null,
        input.evidence_ref || null,
        input.to_status,
        input.attempt_id,
        input.operation_id,
        input.tenant_id,
        input.from_status,
      ],
      read_sql: `SELECT attempt_status FROM activation_stage_attempts
                  WHERE attempt_id = ? AND operation_id = ? AND tenant_id = ? LIMIT 1`,
      read_params: [input.attempt_id, input.operation_id, input.tenant_id],
      state_field: "attempt_status",
      target_state: input.to_status,
      conflict_code: "activation_stage_attempt_transition_conflict",
      conflict_message:
        "The stage attempt changed or is outside the authorized tenant and operation scope.",
    });
  },

  async nextReconciliationAttemptNumber(pool, input) {
    const [rows] = await pool.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM activation_reconciliation_attempts
        WHERE operation_id = ? AND tenant_id = ?`,
      [input.operation_id, input.tenant_id],
    );
    return Number(rows?.[0]?.next_attempt_number || 1);
  },

  async hasSameOperationSuccessEvidence(pool, input) {
    const placeholders = ACTIVATION_SUCCESS_EVIDENCE_TYPES.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT evidence_id FROM activation_evidence_items
        WHERE operation_id = ? AND tenant_id = ?
          AND evidence_type IN (${placeholders})
          AND secrets_included = 0
          AND redaction_state IN ('sanitized','reference_only')
        LIMIT 1`,
      [input.operation_id, input.tenant_id, ...ACTIVATION_SUCCESS_EVIDENCE_TYPES],
    );
    return Boolean(rows?.[0]?.evidence_id);
  },
});

async function transaction(pool, work) {
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

async function requireOperation(repository, connection, actor, operationId) {
  const operation = await repository.readOperation(connection, {
    operation_id: operationId,
    ...actor,
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

function assertVersion(operation, expectedVersion, action) {
  if (Number(operation.optimistic_version) !== expectedVersion) {
    fail(
      "activation_operation_version_conflict",
      `The Activation operation changed before ${action}.`,
      409,
    );
  }
}

async function appendEvidence(repository, connection, actor, operationId, evidence) {
  if (!evidence) return null;
  return repository.appendEvidence(connection, {
    ...evidence,
    operation_id: operationId,
    tenant_id: actor.tenant_id,
  });
}

function assertStageStartAllowed(operation, targetStatus) {
  if (targetStatus) {
    return assertActivationOperationTransition(operation.operation_status, targetStatus);
  }
  const classification = classifyActivationOperationState(operation.operation_status);
  if (
    classification !== "core_nonterminal" ||
    ["unknown_outcome", "reconciling", "retry_scheduled"].includes(
      operation.operation_status,
    )
  ) {
    fail(
      "activation_stage_attempt_operation_state_invalid",
      "A stage attempt requires an explicit valid operation transition from this state.",
      409,
      { operation_status: operation.operation_status },
    );
  }
  return { allowed: true };
}

export function createActivationLifecycleOperationService({ repository = defaultRepository } = {}) {
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
    "hasSameOperationSuccessEvidence",
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
    async transitionOperation(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const expectedVersion = version(input.expected_version);
      const toStatus = text(input.to_status, "to_status", 64);
      if (toStatus === "active" && input.evidence) {
        assertActivationSuccessEvidenceType(input.evidence.evidence_type);
      }

      return transaction(input.pool, async (connection) => {
        const operation = await requireOperation(repository, connection, actor, operationId);
        assertVersion(operation, expectedVersion, "the lifecycle transition");
        assertActivationOperationTransition(operation.operation_status, toStatus);
        const evidenceRecord = await appendEvidence(
          repository,
          connection,
          actor,
          operationId,
          input.evidence,
        );
        if (
          toStatus === "active" &&
          !(await repository.hasSameOperationSuccessEvidence(connection, {
            operation_id: operationId,
            tenant_id: actor.tenant_id,
          }))
        ) {
          fail(
            "activation_same_operation_success_evidence_required",
            "Active classification requires success readback evidence from the same operation.",
            409,
          );
        }
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...actor,
          expected_version: expectedVersion,
          patch: {
            operation_status: toStatus,
            ...(input.current_stage
              ? { current_stage: text(input.current_stage, "current_stage", 80) }
              : {}),
          },
        });
        return {
          operation_id: operationId,
          from_status: operation.operation_status,
          to_status: toStatus,
          optimistic_version: update.optimistic_version,
          evidence_id: evidenceRecord?.evidence_id || null,
          evidence_verified: toStatus === "active" ? true : undefined,
          secrets_included: false,
        };
      });
    },

    async startStageAttempt(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const stageKey = text(input.stage_key, "stage_key", 80);
      const targetStatus = input.operation_target_status
        ? text(input.operation_target_status, "operation_target_status", 64)
        : null;
      const expectedVersion = targetStatus ? version(input.expected_version) : null;

      return transaction(input.pool, async (connection) => {
        const operation = await requireOperation(repository, connection, actor, operationId);
        assertStageStartAllowed(operation, targetStatus);
        if (targetStatus) assertVersion(operation, expectedVersion, "the stage attempt started");

        const attemptNumber = await repository.nextStageAttemptNumber(connection, {
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          stage_key: stageKey,
        });
        const inserted = await repository.appendStageAttempt(connection, {
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          stage_key: stageKey,
          attempt_number: attemptNumber,
          source_type: input.source_type || "platform_native",
          attempt_status: "pending",
        });
        assertActivationStageAttemptTransition("pending", "running");
        await repository.transitionStageAttempt(connection, {
          attempt_id: inserted.attempt_id,
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          from_status: "pending",
          to_status: "running",
        });

        let nextVersion = Number(operation.optimistic_version);
        if (targetStatus) {
          const update = await repository.updateOperation(connection, {
            operation_id: operationId,
            ...actor,
            expected_version: expectedVersion,
            patch: { operation_status: targetStatus, current_stage: stageKey },
          });
          nextVersion = update.optimistic_version;
        }
        return {
          operation_id: operationId,
          attempt_id: inserted.attempt_id,
          attempt_number: attemptNumber,
          stage_key: stageKey,
          attempt_status: "running",
          operation_status: targetStatus || operation.operation_status,
          optimistic_version: nextVersion,
          secrets_included: false,
        };
      });
    },

    async completeStageAttempt(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const attemptId = text(input.attempt_id, "attempt_id", 36);
      const toStatus = text(input.to_status, "stage_attempt_to_status", 64);

      return transaction(input.pool, async (connection) => {
        await requireOperation(repository, connection, actor, operationId);
        const attempt = await repository.readStageAttempt(connection, {
          attempt_id: attemptId,
          operation_id: operationId,
          tenant_id: actor.tenant_id,
        });
        if (!attempt) {
          fail(
            "activation_stage_attempt_not_found",
            "Activation stage attempt was not found in the authorized operation scope.",
            404,
          );
        }
        assertActivationStageAttemptTransition(attempt.attempt_status, toStatus);
        const evidenceRecord = await appendEvidence(
          repository,
          connection,
          actor,
          operationId,
          input.evidence ? { ...input.evidence, attempt_id: attemptId } : null,
        );
        const result = await repository.transitionStageAttempt(connection, {
          attempt_id: attemptId,
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          from_status: attempt.attempt_status,
          to_status: toStatus,
          retryable: input.retryable === true,
          unknown_outcome: toStatus === "unknown_outcome",
          error_code: input.error_code || null,
          error_message: input.error_message || null,
          evidence_ref: evidenceRecord?.evidence_id || null,
        });
        return {
          operation_id: operationId,
          attempt_id: attemptId,
          from_status: attempt.attempt_status,
          to_status: toStatus,
          idempotent: result.idempotent === true,
          evidence_id: evidenceRecord?.evidence_id || null,
          secrets_included: false,
        };
      });
    },

    async scheduleRetry(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const expectedVersion = version(input.expected_version);

      return transaction(input.pool, async (connection) => {
        const operation = await requireOperation(repository, connection, actor, operationId);
        assertVersion(operation, expectedVersion, "retry scheduling");
        const decision = authorizeActivationRetryRequest({
          operation_status: operation.operation_status,
          target_status: input.target_status,
          governed_retry_approved: input.governed_retry_approved,
          approval_ref: input.approval_ref,
        });
        const authorizationEvidence = await repository.appendEvidence(connection, {
          operation_id: operationId,
          tenant_id: actor.tenant_id,
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
          ...actor,
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

    async beginReconciliation(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const expectedVersion = version(input.expected_version);

      return transaction(input.pool, async (connection) => {
        const operation = await requireOperation(repository, connection, actor, operationId);
        assertVersion(operation, expectedVersion, "reconciliation started");
        assertActivationOperationTransition(operation.operation_status, "reconciling");
        const attemptNumber = await repository.nextReconciliationAttemptNumber(
          connection,
          { operation_id: operationId, tenant_id: actor.tenant_id },
        );
        const reconciliation = await repository.appendReconciliation(connection, {
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          attempt_number: attemptNumber,
          reason_code: input.reason_code || "unknown_outcome",
          source_type: input.source_type || "platform_native",
          reconciliation_status: "pending",
        });
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...actor,
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

    async completeReconciliation(input = {}) {
      const actor = subject(input.subject);
      const operationId = text(input.operation_id, "operation_id", 36);
      const reconciliationId = text(
        input.reconciliation_id,
        "reconciliation_id",
        36,
      );
      const expectedVersion = version(input.expected_version);
      if (input.outcome === "executed") {
        if (!input.evidence) {
          fail(
            "activation_same_operation_success_evidence_required",
            "Executed reconciliation requires success readback evidence.",
            409,
          );
        }
        assertActivationSuccessEvidenceType(input.evidence.evidence_type);
      }

      return transaction(input.pool, async (connection) => {
        const operation = await requireOperation(repository, connection, actor, operationId);
        assertVersion(operation, expectedVersion, "reconciliation completion");
        if (operation.operation_status !== "reconciling") {
          fail(
            "activation_reconciliation_operation_state_invalid",
            "Reconciliation can complete only while the operation is reconciling.",
            409,
          );
        }
        const evidenceRecord = await appendEvidence(
          repository,
          connection,
          actor,
          operationId,
          input.evidence,
        );
        const decision = resolveActivationReconciliationOutcome({
          outcome: input.outcome,
          operation_id: operationId,
          evidence_operation_id: evidenceRecord ? operationId : null,
          evidence_verified: Boolean(evidenceRecord),
          evidence_type: input.evidence?.evidence_type || null,
        });
        assertActivationOperationTransition(operation.operation_status, decision.operation_status);
        await repository.completeReconciliation(connection, {
          reconciliation_id: reconciliationId,
          operation_id: operationId,
          tenant_id: actor.tenant_id,
          from_status: "pending",
          to_status: decision.outcome,
          outcome_code: decision.outcome,
          evidence_ref: evidenceRecord?.evidence_id || null,
        });
        const update = await repository.updateOperation(connection, {
          operation_id: operationId,
          ...actor,
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
