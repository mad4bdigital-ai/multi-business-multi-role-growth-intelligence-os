const REASON_CODES = Object.freeze({
  PROVIDER_CHAIN_COMPLETE: "provider_chain_complete",
  PROVIDER_CHAIN_INCOMPLETE: "provider_chain_incomplete",
  MISSING_TRANSPORT_ATTEMPT: "missing_required_activation_transport_attempt",
  EXECUTABLE_BINDING_MISMATCH: "executable_binding_mismatch",
  GOOGLE_SHEETS_RATE_LIMITED: "google_sheets_rate_limited",
  AUTHORIZATION_FAILED: "authorization_failed",
  VALIDATION_INCOMPLETE: "validation_incomplete"
});

/**
 * Classifies activation state from evidence collected during the governed
 * provider chain. Priority order mirrors the enforcement rules:
 *   no transport → degraded
 *   rate_limited → validation_rate_limited
 *   auth_failed  → authorization_gated
 *   binding mismatch → degraded
 *   full chain complete → active
 *   partial provider success → validating
 *   default → degraded
 */
function sheetsStepSatisfied(evidence = {}) {
  return evidence.sheets_ok || evidence.sheets_required === false || evidence.sheets_skipped === true;
}

export function classifyActivationFromEvidence(evidence = {}) {
  if (!evidence.transport_attempted) {
    return {
      activation_status: "degraded",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.MISSING_TRANSPORT_ATTEMPT
    };
  }

  if (evidence.rate_limited) {
    return {
      activation_status: "validation_rate_limited",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.GOOGLE_SHEETS_RATE_LIMITED
    };
  }

  if (evidence.auth_failed) {
    return {
      activation_status: "authorization_gated",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.AUTHORIZATION_FAILED
    };
  }

  if (evidence.executable_binding_mismatch) {
    return {
      activation_status: "degraded",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.EXECUTABLE_BINDING_MISMATCH
    };
  }

  if (
    evidence.drive_ok &&
    sheetsStepSatisfied(evidence) &&
    evidence.github_ok &&
    evidence.bootstrap_row_read &&
    evidence.binding_resolved &&
    evidence.validation_complete
  ) {
    return {
      activation_status: "active",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.PROVIDER_CHAIN_COMPLETE
    };
  }

  if (evidence.drive_ok || evidence.sheets_ok || evidence.github_ok || evidence.bootstrap_row_read) {
    return {
      activation_status: "validating",
      status_authority: "runtime_canonical",
      reason_code: REASON_CODES.VALIDATION_INCOMPLETE
    };
  }

  return {
    activation_status: "degraded",
    status_authority: "runtime_canonical",
    reason_code: REASON_CODES.PROVIDER_CHAIN_INCOMPLETE
  };
}
