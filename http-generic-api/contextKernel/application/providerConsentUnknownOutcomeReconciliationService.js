const ALLOWED_HANDOFF_STATUSES = new Set([
  "ready",
  "leased",
  "retryable",
  "failed",
  "completed",
  "expired",
]);

function reconciliationError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentUnknownOutcomeReconciliationError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function classifyOutcome({ handoff, authorizationState }) {
  if (!handoff && !authorizationState) {
    return Object.freeze({ outcome: "conflict", nextAction: "manual_missing_evidence_review" });
  }
  const stateStatus = authorizationState?.status || null;
  const handoffStatus = handoff?.status || null;
  const providerCheckpointPresent = handoff?.providerCheckpointPresent === true;
  const completionCheckpointPresent = handoff?.completionCheckpointPresent === true;

  if (stateStatus === "consumed" || stateStatus === "completed") {
    if (completionCheckpointPresent || handoffStatus === "completed") {
      return Object.freeze({ outcome: "confirmed_applied", nextAction: "return_safe_completion_readback" });
    }
    return Object.freeze({ outcome: "confirmed_applied", nextAction: "repair_handoff_terminal_marker" });
  }

  if (stateStatus === "claimed") {
    if (completionCheckpointPresent || handoffStatus === "completed") {
      return Object.freeze({ outcome: "conflict", nextAction: "manual_state_handoff_conflict_review" });
    }
    if (providerCheckpointPresent) {
      return Object.freeze({ outcome: "still_unknown", nextAction: "manual_persistence_readback" });
    }
    if (["ready", "retryable", "failed", "expired"].includes(handoffStatus)) {
      return Object.freeze({ outcome: "confirmed_not_applied", nextAction: "prepare_governed_resume_or_new_claim" });
    }
    if (handoffStatus === "leased") {
      return Object.freeze({ outcome: "still_unknown", nextAction: "wait_for_lease_expiry_then_reconcile" });
    }
  }

  if (stateStatus === "revoked" || stateStatus === "expired" || stateStatus === "failed") {
    if (providerCheckpointPresent || completionCheckpointPresent) {
      return Object.freeze({ outcome: "conflict", nextAction: "manual_terminal_state_conflict_review" });
    }
    return Object.freeze({ outcome: "confirmed_not_applied", nextAction: "do_not_resume_terminal_state" });
  }

  return Object.freeze({ outcome: "conflict", nextAction: "manual_unclassified_outcome_review" });
}

export function createProviderConsentUnknownOutcomeReconciliationService({
  handoffReadPort,
  authorizationStateRepository,
  clock = () => new Date(),
} = {}) {
  if (typeof handoffReadPort !== "function") {
    throw new TypeError("handoffReadPort must be a function.");
  }
  if (
    !authorizationStateRepository
    || typeof authorizationStateRepository !== "object"
    || typeof authorizationStateRepository.findAuthorizationState !== "function"
  ) {
    throw new TypeError("authorizationStateRepository with findAuthorizationState() is required.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  async function reconcile({ tenantRef, stateRef, handoffRef } = {}) {
    const tenant = requiredString(tenantRef, "tenantRef");
    const state = requiredString(stateRef, "stateRef");
    const handoff = requiredString(handoffRef, "handoffRef");
    const [handoffReadback, authorizationState] = await Promise.all([
      handoffReadPort({ handoffRef: handoff }),
      authorizationStateRepository.findAuthorizationState({ tenantRef: tenant, stateRef: state }),
    ]);
    if (handoffReadback?.status && !ALLOWED_HANDOFF_STATUSES.has(handoffReadback.status)) {
      throw reconciliationError(
        "provider_consent_handoff_status_unsupported",
        "Unknown-outcome reconciliation observed an unsupported handoff status.",
        502,
        { handoff_status: handoffReadback.status },
      );
    }
    if (authorizationState && authorizationState.tenantRef !== tenant) {
      throw reconciliationError(
        "provider_consent_reconciliation_tenant_mismatch",
        "Authorization-state readback escaped the requested Tenant.",
        409,
      );
    }
    if (authorizationState && authorizationState.stateRef !== state) {
      throw reconciliationError(
        "provider_consent_reconciliation_state_mismatch",
        "Authorization-state readback escaped the requested state reference.",
        409,
      );
    }
    const classification = classifyOutcome({
      handoff: handoffReadback,
      authorizationState,
    });
    const reconciledAt = clock();
    if (!(reconciledAt instanceof Date) || Number.isNaN(reconciledAt.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }
    return freeze({
      status: "reconciled",
      outcome: classification.outcome,
      nextAction: classification.nextAction,
      tenantRef: tenant,
      stateRef: state,
      handoffRef: handoff,
      authorizationStateStatus: authorizationState?.status || null,
      handoffStatus: handoffReadback?.status || null,
      providerCheckpointPresent: handoffReadback?.providerCheckpointPresent === true,
      completionCheckpointPresent: handoffReadback?.completionCheckpointPresent === true,
      automaticRetryAllowed: false,
      automaticRetryPerformed: false,
      providerCallRepeated: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
      reconciledAt: reconciledAt.toISOString(),
    });
  }

  return Object.freeze({ reconcile });
}

export const _testingProviderConsentUnknownOutcomeReconciliationService = Object.freeze({
  classifyOutcome,
});
