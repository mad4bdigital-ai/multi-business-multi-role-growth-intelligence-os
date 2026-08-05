import assert from "node:assert/strict";
import {
  buildTenantGptOAuthTokenErrorResponse,
  classifyTenantGptOAuthTokenExchangeOutcome,
} from "./tenantGptOAuthTokenExchangeOutcomePolicy.js";

const invalidGrantOutcomes = [
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
];

for (const outcome of invalidGrantOutcomes) {
  const decision = classifyTenantGptOAuthTokenExchangeOutcome({
    phase: "before_code_consumption",
    consumption: { consumed: false, outcome, replay_allowed: false },
  });
  assert.equal(decision.http_status, 400);
  assert.equal(decision.oauth_error, "invalid_grant");
  assert.equal(decision.error_code, `oauth_code_${outcome}`);
  assert.equal(decision.retry_same_code, false);
  assert.equal(decision.restart_authorization, true);
  assert.equal(decision.outcome_unknown, false);
  assert.equal(decision.operator_reconciliation_required, false);
  assert.equal(decision.secrets_included, false);
}

const committed = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "response_committed",
  consumption: { consumed: true, outcome: "consumed" },
  response_committed: true,
});
assert.deepEqual(committed, {
  classification: "token_response_committed",
  http_status: 200,
  oauth_error: null,
  error_code: null,
  retry_same_code: false,
  restart_authorization: false,
  outcome_unknown: false,
  operator_reconciliation_required: false,
  failure_reason: null,
  secrets_included: false,
});

const preConsumption = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "before_code_consumption",
  failure_reason: "subject_store_unavailable",
});
assert.equal(preConsumption.classification, "token_exchange_preconsumption_dependency_unavailable");
assert.equal(preConsumption.http_status, 503);
assert.equal(preConsumption.oauth_error, "temporarily_unavailable");
assert.equal(preConsumption.error_code, "oauth_token_exchange_preconsumption_unavailable");
assert.equal(preConsumption.retry_same_code, true);
assert.equal(preConsumption.restart_authorization, false);
assert.equal(preConsumption.outcome_unknown, false);
assert.equal(preConsumption.operator_reconciliation_required, false);

const postConsumption = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "after_code_consumption",
  consumption: { consumed: true, outcome: "consumed", replay_allowed: false },
  failure_reason: "jwt_response_unavailable",
});
assert.equal(postConsumption.classification, "consumed_without_committed_token_response");
assert.equal(postConsumption.http_status, 503);
assert.equal(postConsumption.oauth_error, "temporarily_unavailable");
assert.equal(postConsumption.error_code, "oauth_token_response_not_committed");
assert.equal(postConsumption.retry_same_code, false);
assert.equal(postConsumption.restart_authorization, false);
assert.equal(postConsumption.outcome_unknown, true);
assert.equal(postConsumption.operator_reconciliation_required, true);

const unknownConsumption = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "code_consumption",
  consumption: {
    consumed: false,
    outcome: "consumption_outcome_unknown",
    replay_allowed: false,
    store_error_code: "ECONNRESET",
  },
});
assert.equal(unknownConsumption.error_code, "oauth_code_consumption_outcome_unknown");
assert.equal(unknownConsumption.retry_same_code, false);
assert.equal(unknownConsumption.restart_authorization, false);
assert.equal(unknownConsumption.outcome_unknown, true);
assert.equal(unknownConsumption.operator_reconciliation_required, true);

const issuedReadback = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "code_consumption",
  consumption: {
    consumed: false,
    outcome: "store_unavailable_code_still_issued",
    replay_allowed: true,
    store_error_code: "ETIMEDOUT",
  },
});
assert.equal(issuedReadback.error_code, "oauth_code_store_temporarily_unavailable");
assert.equal(issuedReadback.http_status, 503);
assert.equal(issuedReadback.retry_same_code, true);
assert.equal(issuedReadback.restart_authorization, false);
assert.equal(issuedReadback.outcome_unknown, false);
assert.equal(issuedReadback.operator_reconciliation_required, false);

const preConsumptionBody = buildTenantGptOAuthTokenErrorResponse(preConsumption, {
  request_id: "request-safe-pre",
});
assert.equal(preConsumptionBody.error, "temporarily_unavailable");
assert.equal(preConsumptionBody.error_code, "oauth_token_exchange_preconsumption_unavailable");
assert.equal(preConsumptionBody.retry_same_code, true);
assert.equal(preConsumptionBody.restart_authorization, false);
assert.equal(preConsumptionBody.outcome_unknown, false);

const unknownBody = buildTenantGptOAuthTokenErrorResponse(unknownConsumption, {
  request_id: "request-safe-123",
});
assert.deepEqual(unknownBody, {
  error: "temporarily_unavailable",
  error_description: "The authorization-code consumption result is unknown. Do not replay this code until the exchange is reconciled.",
  error_code: "oauth_code_consumption_outcome_unknown",
  request_id: "request-safe-123",
  retry_same_code: false,
  restart_authorization: false,
  outcome_unknown: true,
  operator_reconciliation_required: true,
  secrets_included: false,
});

const issuedBody = buildTenantGptOAuthTokenErrorResponse(issuedReadback, {
  request_id: "request-safe-456",
});
assert.equal(issuedBody.error, "temporarily_unavailable");
assert.equal(issuedBody.retry_same_code, true);
assert.equal(issuedBody.restart_authorization, false);
assert.equal(issuedBody.outcome_unknown, false);

const invalidDecision = classifyTenantGptOAuthTokenExchangeOutcome({
  phase: "before_code_consumption",
  consumption: { consumed: false, outcome: "expired" },
});
const invalidBody = buildTenantGptOAuthTokenErrorResponse(invalidDecision, {
  request_id: "request-safe-789",
});
assert.equal(invalidBody.error, "invalid_grant");
assert.equal(invalidBody.restart_authorization, true);
assert.equal(invalidBody.retry_same_code, false);
assert.equal(invalidBody.outcome_unknown, false);

for (const value of [preConsumptionBody, unknownBody, issuedBody, invalidBody]) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("client_secret"), false);
  assert.equal(serialized.includes("authorization_code="), false);
  assert.equal(value.secrets_included, false);
  assert.equal(Object.isFrozen(value), true);
}

assert.throws(
  () => classifyTenantGptOAuthTokenExchangeOutcome({ phase: "invented" }),
  /governed OAuth token-exchange phase/,
);
assert.throws(
  () => buildTenantGptOAuthTokenErrorResponse(committed),
  /OAuth error decision is required/,
);

console.log("PASS tenant-gpt-oauth-token-exchange-outcome-policy");
