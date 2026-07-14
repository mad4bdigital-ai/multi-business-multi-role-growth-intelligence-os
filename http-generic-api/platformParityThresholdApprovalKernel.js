export const PARITY_THRESHOLD_APPROVAL_VERSION = "platform-parity-threshold-approval-v1";
export const PARITY_THRESHOLD_SCOPE = "adaptive-authorization-canary-thresholds";
export const PARITY_THRESHOLD_TYPED_CONFIRMATION = "APPROVE_T042_PARITY_THRESHOLDS_ONLY_NO_CANARY";

export const DEFAULT_PARITY_THRESHOLDS = Object.freeze({
  crossTenantDenialPassRateMin: 1,
  replayAndStaleEnvelopePassRateMin: 1,
  unresolvedCriticalPrivilegeExpansionMax: 0,
  deterministicDecisionRepeatabilityMin: 0.999,
  credentialLeakageFindingsMax: 0,
  stateChangingPilotIdempotencyReadbackRateMin: 1,
  unresolvedAmbiguousAdapterSelectionMax: 0,
  decisionLatencySloRequired: true,
  reconciliationLagWithinPolicyRequired: true,
  securityReviewCompleteRequired: true,
  rollbackReadbackEvidenceApprovedRequired: true,
});

function requiredText(value, name) {
  const output = String(value ?? "").trim();
  if (!output) {
    throw Object.assign(new TypeError(`${name} is required.`), {
      code: "parity_threshold_field_required",
      status: 422,
      field: name,
    });
  }
  return output;
}

function finiteNumber(value, name) {
  const output = Number(value);
  if (!Number.isFinite(output)) {
    throw Object.assign(new TypeError(`${name} must be a finite number.`), {
      code: "parity_threshold_number_invalid",
      status: 422,
      field: name,
    });
  }
  return output;
}

function sha256(value, name) {
  const output = requiredText(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(output)) {
    throw Object.assign(new TypeError(`${name} must be a SHA-256 hex digest.`), {
      code: "parity_threshold_hash_invalid",
      status: 422,
      field: name,
    });
  }
  return output;
}

function isoInstant(value, name) {
  const output = requiredText(value, name);
  if (Number.isNaN(Date.parse(output))) {
    throw Object.assign(new TypeError(`${name} must be an ISO-8601 timestamp.`), {
      code: "parity_threshold_timestamp_invalid",
      status: 422,
      field: name,
    });
  }
  return output;
}

export function approveParityThresholdPolicy(input = {}) {
  if (input.typedConfirmation !== PARITY_THRESHOLD_TYPED_CONFIRMATION) {
    throw Object.assign(new TypeError("Typed confirmation does not match the T042 threshold-only approval contract."), {
      code: "parity_threshold_typed_confirmation_mismatch",
      status: 409,
    });
  }

  const thresholds = Object.freeze({
    ...DEFAULT_PARITY_THRESHOLDS,
    ...(input.thresholds || {}),
  });

  const approvedAt = isoInstant(input.approvedAt, "approvedAt");
  const expiresAt = isoInstant(input.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(approvedAt)) {
    throw Object.assign(new TypeError("expiresAt must be later than approvedAt."), {
      code: "parity_threshold_approval_window_invalid",
      status: 422,
    });
  }

  return Object.freeze({
    schema_version: PARITY_THRESHOLD_APPROVAL_VERSION,
    scopeKey: PARITY_THRESHOLD_SCOPE,
    policyVersion: requiredText(input.policyVersion, "policyVersion"),
    approvalId: requiredText(input.approvalId, "approvalId"),
    approvedBy: requiredText(input.approvedBy, "approvedBy"),
    approvedAt,
    expiresAt,
    thresholdPolicyHash: sha256(input.thresholdPolicyHash, "thresholdPolicyHash"),
    classificationEvidenceHash: sha256(input.classificationEvidenceHash, "classificationEvidenceHash"),
    approvalStatus: "approved_for_canary_evaluation_only",
    thresholds,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    canaryActivationAllowed: false,
    enforcementCutover: false,
    migrationExecutionAuthorized: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
  });
}

export function evaluateParityThresholdEvidence(input = {}) {
  const approvedPolicy = input.approvedPolicy;
  if (!approvedPolicy || approvedPolicy.approvalStatus !== "approved_for_canary_evaluation_only") {
    throw Object.assign(new TypeError("An approved T042 threshold policy is required."), {
      code: "parity_threshold_approval_required",
      status: 409,
    });
  }

  const evaluatedAt = isoInstant(input.evaluatedAt, "evaluatedAt");
  const expired = Date.parse(evaluatedAt) >= Date.parse(approvedPolicy.expiresAt);
  const evidence = input.evidence || {};
  const thresholds = approvedPolicy.thresholds;

  const checks = Object.freeze([
    {
      key: "cross_tenant_denial",
      passed: finiteNumber(evidence.crossTenantDenialPassRate, "crossTenantDenialPassRate") >= thresholds.crossTenantDenialPassRateMin,
    },
    {
      key: "replay_and_stale_envelope",
      passed: finiteNumber(evidence.replayAndStaleEnvelopePassRate, "replayAndStaleEnvelopePassRate") >= thresholds.replayAndStaleEnvelopePassRateMin,
    },
    {
      key: "critical_privilege_expansion",
      passed: finiteNumber(evidence.unresolvedCriticalPrivilegeExpansionCount, "unresolvedCriticalPrivilegeExpansionCount") <= thresholds.unresolvedCriticalPrivilegeExpansionMax,
    },
    {
      key: "decision_repeatability",
      passed: finiteNumber(evidence.deterministicDecisionRepeatability, "deterministicDecisionRepeatability") >= thresholds.deterministicDecisionRepeatabilityMin,
    },
    {
      key: "credential_leakage",
      passed: finiteNumber(evidence.credentialLeakageFindingCount, "credentialLeakageFindingCount") <= thresholds.credentialLeakageFindingsMax,
    },
    {
      key: "idempotency_and_readback",
      passed: finiteNumber(evidence.stateChangingPilotIdempotencyReadbackRate, "stateChangingPilotIdempotencyReadbackRate") >= thresholds.stateChangingPilotIdempotencyReadbackRateMin,
    },
    {
      key: "adapter_ambiguity",
      passed: finiteNumber(evidence.unresolvedAmbiguousAdapterSelectionCount, "unresolvedAmbiguousAdapterSelectionCount") <= thresholds.unresolvedAmbiguousAdapterSelectionMax,
    },
    {
      key: "decision_latency_slo",
      passed: thresholds.decisionLatencySloRequired ? evidence.decisionLatencySloMet === true : true,
    },
    {
      key: "reconciliation_lag",
      passed: thresholds.reconciliationLagWithinPolicyRequired ? evidence.reconciliationLagWithinPolicy === true : true,
    },
    {
      key: "security_review",
      passed: thresholds.securityReviewCompleteRequired ? evidence.securityReviewComplete === true : true,
    },
    {
      key: "rollback_readback_evidence",
      passed: thresholds.rollbackReadbackEvidenceApprovedRequired ? evidence.rollbackReadbackEvidenceApproved === true : true,
    },
  ]);

  const failedChecks = Object.freeze(checks.filter((check) => !check.passed).map((check) => check.key));
  const evidenceHash = sha256(input.evidenceHash, "evidenceHash");
  const eligibleForCanaryEvaluation = !expired && failedChecks.length === 0;

  return Object.freeze({
    ok: eligibleForCanaryEvaluation,
    schema_version: PARITY_THRESHOLD_APPROVAL_VERSION,
    scopeKey: PARITY_THRESHOLD_SCOPE,
    policyVersion: approvedPolicy.policyVersion,
    approvalId: approvedPolicy.approvalId,
    evaluatedAt,
    approvalExpired: expired,
    evidenceHash,
    checks,
    failedChecks,
    eligibleForCanaryEvaluation,
    canaryActivationAllowed: false,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    migrationExecutionAuthorized: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
    nextRequiredAction: eligibleForCanaryEvaluation
      ? "separate_explicit_canary_authority_required"
      : "resolve_threshold_failures_before_canary_evaluation",
  });
}
