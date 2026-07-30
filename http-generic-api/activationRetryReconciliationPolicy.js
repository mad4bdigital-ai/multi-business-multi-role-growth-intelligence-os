import {
  ACTIVATION_OPERATION_STABLE_RETRY_STATES,
  ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY,
  ACTIVATION_OPERATION_TRANSITIONS,
  classifyActivationOperationState,
} from "./activationLifecycleStateMachine.js";

const STABLE_RETRY_STATES = new Set(ACTIVATION_OPERATION_STABLE_RETRY_STATES);
const TERMINAL_WITHOUT_RETRY = new Set(ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY);
const RETRY_TARGETS = new Set(ACTIVATION_OPERATION_TRANSITIONS.retry_scheduled || []);
const RECONCILIATION_OUTCOMES = new Set([
  "executed",
  "not_executed",
  "conflicting",
  "still_unknown",
  "failed",
]);
const SUCCESS_EVIDENCE_TYPES = new Set([
  "activation_success_readback",
  "execution_readback",
  "provider_readback",
  "reconciliation_readback",
]);

function fail(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeText(value, field, max = 500, { required = true } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) fail(`activation_${field}_required`, `${field} is required.`, 400);
    return null;
  }
  if (normalized.length > max) {
    fail(`activation_${field}_too_long`, `${field} exceeds ${max} characters.`, 400);
  }
  return normalized;
}

export function assertActivationSuccessEvidenceType(evidenceType) {
  const normalized = normalizeText(evidenceType, "success_evidence_type", 80);
  if (!SUCCESS_EVIDENCE_TYPES.has(normalized)) {
    fail(
      "activation_success_evidence_type_invalid",
      `${normalized} cannot authorize an active Activation classification.`,
      409,
      { evidence_type: normalized, allowed_types: [...SUCCESS_EVIDENCE_TYPES] },
    );
  }
  return normalized;
}

export function assertSameActivationOperationEvidence({
  operation_id,
  evidence_operation_id,
  evidence_verified,
} = {}) {
  const operationId = normalizeText(operation_id, "operation_id", 36);
  const evidenceOperationId = normalizeText(evidence_operation_id, "evidence_operation_id", 36);
  if (evidence_verified !== true || evidenceOperationId !== operationId) {
    fail(
      "activation_same_operation_evidence_required",
      "Active classification requires verified evidence from the same Activation operation.",
      409,
      {
        operation_id: operationId,
        evidence_operation_id: evidenceOperationId,
        evidence_verified: evidence_verified === true,
      },
    );
  }
  return {
    verified: true,
    operation_id: operationId,
    evidence_operation_id: evidenceOperationId,
  };
}

export function authorizeActivationRetryRequest({
  operation_status,
  target_status,
  governed_retry_approved,
  approval_ref,
} = {}) {
  const operationStatus = normalizeText(operation_status, "operation_status", 64);
  classifyActivationOperationState(operationStatus);

  if (TERMINAL_WITHOUT_RETRY.has(operationStatus)) {
    fail(
      "activation_retry_terminal",
      `Activation operation cannot retry from terminal state ${operationStatus}.`,
      409,
      { operation_status: operationStatus },
    );
  }
  if (operationStatus === "unknown_outcome") {
    fail(
      "activation_reconciliation_required",
      "Unknown Activation outcome must be reconciled before any retry is scheduled.",
      409,
      { operation_status: operationStatus },
    );
  }
  if (operationStatus === "reconciling") {
    fail(
      "activation_reconciliation_in_progress",
      "Activation reconciliation must finish before retry scheduling.",
      409,
      { operation_status: operationStatus },
    );
  }
  if (!STABLE_RETRY_STATES.has(operationStatus)) {
    fail(
      "activation_retry_source_state_invalid",
      `Activation retry cannot be scheduled from ${operationStatus}.`,
      409,
      { operation_status: operationStatus },
    );
  }
  if (governed_retry_approved !== true) {
    fail(
      "activation_governed_retry_approval_required",
      `Activation retry from ${operationStatus} requires a governed approval.`,
      403,
      { operation_status: operationStatus },
    );
  }

  const targetStatus = normalizeText(target_status, "retry_target_status", 64);
  if (!RETRY_TARGETS.has(targetStatus)) {
    fail(
      "activation_retry_target_invalid",
      `${targetStatus} is not a declared retry target.`,
      400,
      { target_status: targetStatus, allowed_targets: [...RETRY_TARGETS] },
    );
  }

  return {
    allowed: true,
    source_status: operationStatus,
    scheduled_status: "retry_scheduled",
    target_status: targetStatus,
    approval_ref: normalizeText(approval_ref, "retry_approval_ref", 500),
    requires_new_stage_attempt: true,
    blind_replay_allowed: false,
  };
}

export function resolveActivationReconciliationOutcome({
  outcome,
  operation_id,
  evidence_operation_id = null,
  evidence_verified = false,
  evidence_type = null,
} = {}) {
  const normalizedOutcome = normalizeText(outcome, "reconciliation_outcome", 64);
  if (!RECONCILIATION_OUTCOMES.has(normalizedOutcome)) {
    fail(
      "activation_reconciliation_outcome_invalid",
      `${normalizedOutcome} is not a declared reconciliation outcome.`,
      400,
      { outcome: normalizedOutcome },
    );
  }

  if (normalizedOutcome === "executed") {
    assertSameActivationOperationEvidence({
      operation_id,
      evidence_operation_id,
      evidence_verified,
    });
    assertActivationSuccessEvidenceType(evidence_type);
    return {
      outcome: normalizedOutcome,
      operation_status: "active",
      retry_allowed: false,
      governed_retry_required: false,
      reconciliation_required: false,
    };
  }
  if (normalizedOutcome === "not_executed") {
    return {
      outcome: normalizedOutcome,
      operation_status: "degraded",
      retry_allowed: true,
      governed_retry_required: true,
      reconciliation_required: false,
    };
  }
  if (normalizedOutcome === "conflicting") {
    return {
      outcome: normalizedOutcome,
      operation_status: "failed",
      retry_allowed: false,
      governed_retry_required: true,
      reconciliation_required: false,
    };
  }
  if (normalizedOutcome === "still_unknown") {
    return {
      outcome: normalizedOutcome,
      operation_status: "unknown_outcome",
      retry_allowed: false,
      governed_retry_required: false,
      reconciliation_required: true,
    };
  }
  return {
    outcome: normalizedOutcome,
    operation_status: "degraded",
    retry_allowed: false,
    governed_retry_required: true,
    reconciliation_required: false,
  };
}

export const ACTIVATION_RECONCILIATION_OUTCOMES = Object.freeze([
  ...RECONCILIATION_OUTCOMES,
]);
export const ACTIVATION_SUCCESS_EVIDENCE_TYPES = Object.freeze([
  ...SUCCESS_EVIDENCE_TYPES,
]);
