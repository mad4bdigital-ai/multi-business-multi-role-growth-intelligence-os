import {
  ACTIVATION_EVIDENCE_MAX_BYTES,
  appendActivationEvidenceItem,
  appendActivationReconciliationAttempt,
  appendActivationStageAttempt,
  completeActivationReconciliationAttempt,
  createActivationOperationProjection,
  readActivationOperationProjection,
  updateActivationOperationProjection,
} from "./activationOperationProjectionRepository.js";
import { ACTIVATION_SUCCESS_EVIDENCE_TYPES } from "./activationRetryReconciliationPolicy.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_REDACTION_STATES = new Set(["sanitized", "reference_only"]);
const STAGE_ATTEMPT_TRANSITIONS = Object.freeze({
  pending: new Set(["running", "cancelled"]),
  started: new Set([
    "running",
    "succeeded",
    "degraded",
    "failed",
    "unknown_outcome",
    "cancelled",
  ]),
  running: new Set([
    "succeeded",
    "degraded",
    "failed",
    "unknown_outcome",
    "cancelled",
  ]),
});
const TERMINAL_STAGE_ATTEMPT_STATES = new Set([
  "succeeded",
  "degraded",
  "failed",
  "unknown_outcome",
  "cancelled",
]);
const ERROR_BEARING_STAGE_ATTEMPT_STATES = new Set([
  "degraded",
  "failed",
  "unknown_outcome",
]);
const RETRYABLE_STAGE_ATTEMPT_STATES = new Set(["degraded", "failed"]);

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== "function") {
    fail(
      "activation_persistence_pool_required",
      "A database connection with query() is required.",
      500,
    );
  }
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

function normalizeUuid(value, field) {
  const normalized = normalizeText(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) {
    fail(`activation_${field}_invalid`, `${field} must be a UUID.`);
  }
  return normalized;
}

function normalizeState(value, field) {
  const normalized = normalizeText(value, field, 80).toLowerCase();
  if (!STATE_PATTERN.test(normalized)) {
    fail(`activation_${field}_invalid`, `${field} must use lowercase state-key syntax.`);
  }
  return normalized;
}

function normalizeEvidenceTypes(values, { required = false } = {}) {
  if (values == null && !required) return [];
  if (!Array.isArray(values) || values.length === 0) {
    fail(
      "activation_evidence_types_invalid",
      "evidence_types must be a non-empty array.",
    );
  }
  const normalized = [...new Set(values.map((value) => normalizeState(value, "evidence_type")))];
  if (normalized.length > 32) {
    fail(
      "activation_evidence_types_too_many",
      "No more than 32 evidence types may be queried at once.",
    );
  }
  return normalized;
}

function normalizeStageTransition(fromStatus, toStatus) {
  const from = normalizeState(fromStatus, "stage_attempt_from_status");
  const to = normalizeState(toStatus, "stage_attempt_to_status");
  if (!STAGE_ATTEMPT_TRANSITIONS[from]?.has(to)) {
    fail(
      "activation_stage_attempt_transition_invalid",
      `Stage attempt cannot transition from ${from} to ${to}.`,
      409,
      { from_status: from, to_status: to },
    );
  }
  return { from_status: from, to_status: to };
}

async function readSingle(pool, sql, params) {
  requirePool(pool);
  const [rows] = await pool.query(sql, params);
  return rows?.[0] || null;
}

async function lockActivationOperationScope(pool, operationId, tenantId) {
  const locked = await readSingle(
    pool,
    `SELECT operation_id
       FROM activation_operation_projections
      WHERE operation_id = ?
        AND tenant_id = ?
      FOR UPDATE`,
    [operationId, tenantId],
  );
  if (!locked?.operation_id) {
    fail(
      "activation_operation_not_found",
      "Activation operation was not found in the authorized tenant scope.",
      404,
    );
  }
}

function validateNextAttemptNumber(value, code, message) {
  const next = Number(value || 1);
  if (!Number.isSafeInteger(next) || next < 1) fail(code, message, 500);
  return next;
}

export async function appendActivationStageAttemptRecord(pool, input = {}) {
  const attemptStatus = input.attempt_status
    ? normalizeState(input.attempt_status, "attempt_status")
    : "pending";
  return appendActivationStageAttempt(pool, {
    ...input,
    attempt_status: attemptStatus,
  });
}

export async function nextActivationStageAttemptNumber(
  pool,
  { operation_id, tenant_id, stage_key } = {},
) {
  requirePool(pool);
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  const stageKey = normalizeState(stage_key, "stage_key");
  await lockActivationOperationScope(pool, operationId, tenantId);
  const row = await readSingle(
    pool,
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
       FROM activation_stage_attempts
      WHERE operation_id = ?
        AND tenant_id = ?
        AND stage_key = ?`,
    [operationId, tenantId, stageKey],
  );
  return validateNextAttemptNumber(
    row?.next_attempt_number,
    "activation_stage_attempt_number_invalid",
    "The next stage-attempt number could not be determined.",
  );
}

export async function readActivationStageAttempt(
  pool,
  { attempt_id, operation_id, tenant_id } = {},
) {
  const attemptId = normalizeUuid(attempt_id, "attempt_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  return readSingle(
    pool,
    `SELECT attempt_id, operation_id, tenant_id, stage_key, attempt_number,
            source_type, attempt_status, retryable, unknown_outcome,
            error_code, started_at, completed_at, created_at
       FROM activation_stage_attempts
      WHERE attempt_id = ?
        AND operation_id = ?
        AND tenant_id = ?
      LIMIT 1`,
    [attemptId, operationId, tenantId],
  );
}

export async function transitionActivationStageAttempt(pool, input = {}) {
  requirePool(pool);
  const attemptId = normalizeUuid(input.attempt_id, "attempt_id");
  const operationId = normalizeUuid(input.operation_id, "operation_id");
  const tenantId = normalizeText(input.tenant_id, "tenant_id", 36);
  const transition = normalizeStageTransition(input.from_status, input.to_status);
  const errorBearing = ERROR_BEARING_STAGE_ATTEMPT_STATES.has(transition.to_status);
  const errorCode = errorBearing
    ? normalizeText(input.error_code, "error_code", 160, { required: false })
    : null;
  const errorMessage = errorBearing
    ? normalizeText(input.error_message, "error_message", 1000, { required: false })
    : null;
  const evidenceRef = normalizeText(input.evidence_ref, "evidence_ref", 500, {
    required: false,
  });
  const terminal = TERMINAL_STAGE_ATTEMPT_STATES.has(transition.to_status);
  const retryable =
    RETRYABLE_STAGE_ATTEMPT_STATES.has(transition.to_status) && input.retryable === true;
  const unknownOutcome = transition.to_status === "unknown_outcome";
  const [result] = await pool.query(
    `UPDATE activation_stage_attempts
        SET attempt_status = ?,
            retryable = ?,
            unknown_outcome = ?,
            error_code = ?,
            error_message = ?,
            evidence_ref = ?,
            completed_at = CASE
              WHEN ? = 1 THEN COALESCE(completed_at, UTC_TIMESTAMP(3))
              ELSE completed_at
            END
      WHERE attempt_id = ?
        AND operation_id = ?
        AND tenant_id = ?
        AND attempt_status = ?`,
    [
      transition.to_status,
      retryable ? 1 : 0,
      unknownOutcome ? 1 : 0,
      errorCode,
      errorMessage,
      evidenceRef,
      terminal ? 1 : 0,
      attemptId,
      operationId,
      tenantId,
      transition.from_status,
    ],
  );
  if (Number(result?.affectedRows || 0) === 1) {
    return { updated: true, idempotent: false, state: transition.to_status };
  }
  const current = await readActivationStageAttempt(pool, {
    attempt_id: attemptId,
    operation_id: operationId,
    tenant_id: tenantId,
  });
  if (current?.attempt_status === transition.to_status) {
    return { updated: false, idempotent: true, state: transition.to_status };
  }
  fail(
    "activation_stage_attempt_transition_conflict",
    "The stage attempt changed or is outside the authorized tenant and operation scope.",
    409,
  );
}

export async function nextActivationReconciliationAttemptNumber(
  pool,
  { operation_id, tenant_id } = {},
) {
  requirePool(pool);
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  await lockActivationOperationScope(pool, operationId, tenantId);
  const row = await readSingle(
    pool,
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
       FROM activation_reconciliation_attempts
      WHERE operation_id = ?
        AND tenant_id = ?`,
    [operationId, tenantId],
  );
  return validateNextAttemptNumber(
    row?.next_attempt_number,
    "activation_reconciliation_attempt_number_invalid",
    "The next reconciliation-attempt number could not be determined.",
  );
}

export async function readActivationReconciliationAttempt(
  pool,
  { reconciliation_id, operation_id, tenant_id } = {},
) {
  const reconciliationId = normalizeUuid(reconciliation_id, "reconciliation_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  return readSingle(
    pool,
    `SELECT reconciliation_id, operation_id, tenant_id, attempt_number,
            reason_code, source_type, reconciliation_status, outcome_code,
            started_at, completed_at, created_at
       FROM activation_reconciliation_attempts
      WHERE reconciliation_id = ?
        AND operation_id = ?
        AND tenant_id = ?
      LIMIT 1`,
    [reconciliationId, operationId, tenantId],
  );
}

export async function readActivationEvidenceItem(
  pool,
  { evidence_id, operation_id, tenant_id } = {},
) {
  const evidenceId = normalizeUuid(evidence_id, "evidence_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  return readSingle(
    pool,
    `SELECT evidence_id, operation_id, attempt_id, tenant_id, evidence_type,
            source_type, evidence_sha256, summary_json, summary_bytes,
            redaction_state, captured_at, created_at
       FROM activation_evidence_items
      WHERE evidence_id = ?
        AND operation_id = ?
        AND tenant_id = ?
        AND secrets_included = 0
        AND redaction_state IN ('sanitized', 'reference_only')
        AND summary_bytes <= ?
      LIMIT 1`,
    [evidenceId, operationId, tenantId, ACTIVATION_EVIDENCE_MAX_BYTES],
  );
}

export async function hasScopedActivationEvidenceItem(
  pool,
  { evidence_id, operation_id, tenant_id, evidence_types = null } = {},
) {
  requirePool(pool);
  const evidenceId = normalizeUuid(evidence_id, "evidence_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  const evidenceTypes = normalizeEvidenceTypes(evidence_types);
  const typeSql = evidenceTypes.length
    ? ` AND evidence_type IN (${evidenceTypes.map(() => "?").join(",")})`
    : "";
  const row = await readSingle(
    pool,
    `SELECT evidence_id
       FROM activation_evidence_items
      WHERE evidence_id = ?
        AND operation_id = ?
        AND tenant_id = ?
        AND secrets_included = 0
        AND redaction_state IN ('sanitized', 'reference_only')
        AND summary_bytes <= ?${typeSql}
      LIMIT 1`,
    [
      evidenceId,
      operationId,
      tenantId,
      ACTIVATION_EVIDENCE_MAX_BYTES,
      ...evidenceTypes,
    ],
  );
  return Boolean(row?.evidence_id);
}

export function createActivationOperationPersistenceRepository() {
  return Object.freeze({
    createOperation: createActivationOperationProjection,
    readOperation: readActivationOperationProjection,
    updateOperation: updateActivationOperationProjection,
    appendStageAttempt: appendActivationStageAttemptRecord,
    nextStageAttemptNumber: nextActivationStageAttemptNumber,
    readStageAttempt: readActivationStageAttempt,
    transitionStageAttempt: transitionActivationStageAttempt,
    appendEvidence: appendActivationEvidenceItem,
    readEvidence: readActivationEvidenceItem,
    hasEvidence: hasScopedActivationEvidenceItem,
    async hasSameOperationSuccessEvidence(pool, input) {
      return hasScopedActivationEvidenceItem(pool, {
        ...input,
        evidence_types: ACTIVATION_SUCCESS_EVIDENCE_TYPES,
      });
    },
    appendReconciliation: appendActivationReconciliationAttempt,
    nextReconciliationAttemptNumber: nextActivationReconciliationAttemptNumber,
    readReconciliation: readActivationReconciliationAttempt,
    completeReconciliation: completeActivationReconciliationAttempt,
  });
}

export const activationOperationPersistenceRepository =
  createActivationOperationPersistenceRepository();
export const ACTIVATION_SAFE_EVIDENCE_REDACTION_STATES = Object.freeze([
  ...SAFE_REDACTION_STATES,
]);
export const ACTIVATION_STAGE_ATTEMPT_TRANSITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(STAGE_ATTEMPT_TRANSITIONS).map(([state, targets]) => [
      state,
      Object.freeze([...targets]),
    ]),
  ),
);
