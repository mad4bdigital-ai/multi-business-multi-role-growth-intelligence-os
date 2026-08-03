const VERIFIED_INVALID_GRANT_OUTCOMES = new Set([
  "not_found",
  "binding_mismatch",
  "expired",
  "already_consumed",
  "revoked",
  "invalid",
  "payload_invalid",
  "client_mismatch",
  "resource_invalid",
  "redirect_mismatch",
  "user_inactive",
  "membership_inactive",
]);

const ALLOWED_PHASES = new Set([
  "before_code_consumption",
  "code_consumption",
  "after_code_consumption",
  "response_committed",
]);

function text(value, max = 128) {
  return String(value || "").trim().slice(0, max) || null;
}

function freezeDecision(value) {
  return Object.freeze({ ...value, secrets_included: false });
}

export function classifyTenantGptOAuthTokenExchangeOutcome({
  phase = "before_code_consumption",
  consumption = null,
  response_committed = false,
  failure_reason = null,
} = {}) {
  if (!ALLOWED_PHASES.has(phase)) {
    throw new TypeError("phase is not a governed OAuth token-exchange phase.");
  }
  const outcome = text(consumption?.outcome, 64);
  const consumed = consumption?.consumed === true || outcome === "consumed";
  const committed = response_committed === true || phase === "response_committed";

  if (committed) {
    return freezeDecision({
      classification: "token_response_committed",
      http_status: 200,
      oauth_error: null,
      error_code: null,
      retry_same_code: false,
      restart_authorization: false,
      outcome_unknown: false,
      operator_reconciliation_required: false,
      failure_reason: null,
    });
  }

  if (consumed || phase === "after_code_consumption") {
    return freezeDecision({
      classification: "consumed_without_committed_token_response",
      http_status: 503,
      oauth_error: "temporarily_unavailable",
      error_code: "oauth_token_response_not_committed",
      retry_same_code: false,
      restart_authorization: false,
      outcome_unknown: true,
      operator_reconciliation_required: true,
      failure_reason: text(failure_reason, 160) || "post_consumption_failure",
    });
  }

  if (outcome === "consumption_outcome_unknown") {
    return freezeDecision({
      classification: "code_consumption_outcome_unknown",
      http_status: 503,
      oauth_error: "temporarily_unavailable",
      error_code: "oauth_code_consumption_outcome_unknown",
      retry_same_code: false,
      restart_authorization: false,
      outcome_unknown: true,
      operator_reconciliation_required: true,
      failure_reason: text(failure_reason, 160) || text(consumption?.store_error_code, 64) || "code_store_outcome_unknown",
    });
  }

  if (outcome === "store_unavailable_code_still_issued") {
    return freezeDecision({
      classification: "code_store_unavailable_issued_readback",
      http_status: 503,
      oauth_error: "temporarily_unavailable",
      error_code: "oauth_code_store_temporarily_unavailable",
      retry_same_code: consumption?.replay_allowed === true,
      restart_authorization: false,
      outcome_unknown: false,
      operator_reconciliation_required: false,
      failure_reason: text(failure_reason, 160) || text(consumption?.store_error_code, 64) || "code_store_unavailable",
    });
  }

  if (VERIFIED_INVALID_GRANT_OUTCOMES.has(outcome)) {
    return freezeDecision({
      classification: `verified_invalid_grant_${outcome}`,
      http_status: 400,
      oauth_error: "invalid_grant",
      error_code: `oauth_code_${outcome}`,
      retry_same_code: false,
      restart_authorization: true,
      outcome_unknown: false,
      operator_reconciliation_required: false,
      failure_reason: text(failure_reason, 160) || `oauth_code_${outcome}`,
    });
  }

  const codeStillAvailable = phase === "before_code_consumption";
  const consumptionAttemptUnknown = phase === "code_consumption";
  return freezeDecision({
    classification: codeStillAvailable
      ? "token_exchange_preconsumption_dependency_unavailable"
      : "token_exchange_dependency_unavailable",
    http_status: 503,
    oauth_error: "temporarily_unavailable",
    error_code: codeStillAvailable
      ? "oauth_token_exchange_preconsumption_unavailable"
      : "oauth_token_exchange_dependency_unavailable",
    retry_same_code: codeStillAvailable,
    restart_authorization: false,
    outcome_unknown: consumptionAttemptUnknown,
    operator_reconciliation_required: consumptionAttemptUnknown,
    failure_reason: text(failure_reason, 160) || "token_exchange_dependency_unavailable",
  });
}

export function buildTenantGptOAuthTokenErrorResponse(decision, { request_id = null } = {}) {
  if (!decision || typeof decision !== "object" || !decision.oauth_error) {
    throw new TypeError("An OAuth error decision is required.");
  }
  const descriptions = {
    oauth_token_response_not_committed:
      "The authorization code was consumed, but a token response was not committed. Do not replay this code; the exchange requires reconciliation.",
    oauth_code_consumption_outcome_unknown:
      "The authorization-code consumption result is unknown. Do not replay this code until the exchange is reconciled.",
    oauth_code_store_temporarily_unavailable:
      "The authorization-code store is temporarily unavailable. Retry only when instructed by the response metadata.",
    oauth_token_exchange_preconsumption_unavailable:
      "The token exchange is temporarily unavailable before code consumption. Retrying the same authorization code is allowed.",
    oauth_token_exchange_dependency_unavailable:
      "The token exchange is temporarily unavailable.",
  };
  const description = decision.oauth_error === "invalid_grant"
    ? "The authorization code is invalid, expired, already used, revoked, or no longer valid for this client, resource, redirect, user, or tenant membership."
    : descriptions[decision.error_code] || "The token exchange is temporarily unavailable.";

  return Object.freeze({
    error: decision.oauth_error,
    error_description: description,
    error_code: decision.error_code,
    request_id: text(request_id, 128),
    retry_same_code: decision.retry_same_code === true,
    restart_authorization: decision.restart_authorization === true,
    outcome_unknown: decision.outcome_unknown === true,
    operator_reconciliation_required: decision.operator_reconciliation_required === true,
    secrets_included: false,
  });
}
