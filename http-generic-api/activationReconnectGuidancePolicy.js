const freezeList = (values) => Object.freeze([...values]);

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

export const ACTIVATION_RECONNECT_ALLOWED_ERROR_CODES = freezeList([
  "USER_JWT_REQUIRED",
  "USER_JWT_INVALID",
  "TOKEN_RESOURCE_INVALID",
]);

export const ACTIVATION_RECONNECT_FORBIDDEN_STAGES = freezeList([
  "membership",
  "workspace",
  "bootstrap",
  "connection",
  "provider_validation",
  "tool_readiness",
  "contract",
  "deployment",
  "delivery",
  "acknowledgement",
  "dispatch_unknown_outcome",
]);

export const ACTIVATION_ERROR_GUIDANCE = Object.freeze({
  USER_JWT_REQUIRED: freezeRecord({
    http_status: 401,
    stage: "gateway",
    stage_classification: "gateway",
    retryable: false,
    reconnect_required: true,
    user_action: "connect_oauth",
    readback: "gateway_auth_log",
  }),
  USER_JWT_INVALID: freezeRecord({
    http_status: 401,
    stage: "gateway",
    stage_classification: "gateway",
    retryable: false,
    reconnect_required: true,
    user_action: "reconnect",
    readback: "token_verification_evidence",
  }),
  TOKEN_RESOURCE_INVALID: freezeRecord({
    http_status: 401,
    stage: "gateway",
    stage_classification: "gateway",
    retryable: false,
    reconnect_required: true,
    user_action: "reconnect_or_correct_client",
    readback: "token_verification_evidence",
  }),
  MEMBERSHIP_REQUIRED: freezeRecord({
    http_status: 403,
    stage: "session",
    stage_classification: "membership",
    retryable: false,
    reconnect_required: false,
    user_action: "request_tenant_access",
    readback: "membership_registry",
  }),
  WORKSPACE_NOT_READY: freezeRecord({
    http_status: 409,
    stage: "bootstrap",
    stage_classification: "workspace",
    retryable: "conditional",
    reconnect_required: false,
    user_action: "complete_workspace_bootstrap",
    readback: "workspace_registry",
  }),
  CONNECTION_REQUIRED: freezeRecord({
    http_status: 409,
    stage: "bootstrap",
    stage_classification: "connection",
    retryable: false,
    reconnect_required: false,
    user_action: "connect_named_app",
    readback: "connection_registry",
  }),
  BOOTSTRAP_VALIDATING: freezeRecord({
    http_status: 202,
    stage: "bootstrap",
    stage_classification: "bootstrap",
    retryable: true,
    reconnect_required: false,
    user_action: "retry_later",
    readback: "bootstrap_evidence",
  }),
  VALIDATION_RATE_LIMITED: freezeRecord({
    http_status: 429,
    stage: "provider_validation",
    stage_classification: "provider_validation",
    retryable: true,
    reconnect_required: false,
    user_action: "retry_after_guidance",
    readback: "provider_response_and_retry_time",
  }),
  ACTIVATION_DEPENDENCY_UNAVAILABLE: freezeRecord({
    http_status: 503,
    stage: "dependency",
    stage_classification: "tool_readiness",
    retryable: true,
    reconnect_required: false,
    user_action: "retry_later",
    readback: "stage_attempt_evidence",
  }),
  ACTIVATION_OUTCOME_UNKNOWN: freezeRecord({
    http_status: 202,
    stage: "dispatch",
    stage_classification: "dispatch_unknown_outcome",
    retryable: "reconcile_first",
    reconnect_required: false,
    user_action: "do_not_replay_blindly",
    readback: "operation_reconciliation_ledger",
  }),
  DEPLOYMENT_STALE: freezeRecord({
    http_status: 503,
    stage: "deployment",
    stage_classification: "deployment",
    retryable: true,
    reconnect_required: false,
    user_action: "wait_for_deploy_or_operator",
    readback: "main_deployed_parity",
  }),
  ACTIVATION_CONTRACT_ERROR: freezeRecord({
    http_status: 502,
    stage: "contract",
    stage_classification: "contract",
    retryable: false,
    reconnect_required: false,
    user_action: "operator_support",
    readback: "schema_client_evidence",
  }),
});

const allowedErrorCodeSet = new Set(ACTIVATION_RECONNECT_ALLOWED_ERROR_CODES);
const forbiddenStageSet = new Set(ACTIVATION_RECONNECT_FORBIDDEN_STAGES);

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeErrorCode(value) {
  const errorCode = String(value ?? "").trim();
  if (!Object.hasOwn(ACTIVATION_ERROR_GUIDANCE, errorCode)) {
    fail(
      "activation_guidance_error_code_invalid",
      "error_code is not declared by the Activation lifecycle guidance contract.",
      400,
      { error_code: errorCode || null },
    );
  }
  return errorCode;
}

export function classifyActivationFailureStage(errorCode) {
  const normalized = normalizeErrorCode(errorCode);
  const guidance = ACTIVATION_ERROR_GUIDANCE[normalized];
  return {
    error_code: normalized,
    source_stage: guidance.stage,
    stage_classification: guidance.stage_classification,
  };
}

export function isActivationReconnectForbiddenStage(stage) {
  return forbiddenStageSet.has(String(stage ?? "").trim());
}

export function resolveActivationReconnectGuidance(input = {}) {
  const errorCode = normalizeErrorCode(input.error_code);
  const guidance = ACTIVATION_ERROR_GUIDANCE[errorCode];
  const observedStage = String(input.observed_stage ?? guidance.stage).trim();

  if (observedStage !== guidance.stage) {
    fail(
      "activation_guidance_stage_mismatch",
      "observed_stage does not match the declared stage for error_code.",
      409,
      {
        error_code: errorCode,
        observed_stage: observedStage || null,
        expected_stage: guidance.stage,
      },
    );
  }

  // Only strict boolean evidence may unlock reconnect guidance.
  const authFailureVerified = input.auth_failure_verified === true;
  const errorAllowsReconnect =
    guidance.reconnect_required === true && allowedErrorCodeSet.has(errorCode);
  const stageForbidsReconnect = forbiddenStageSet.has(
    guidance.stage_classification,
  );
  const reconnectRequired =
    errorAllowsReconnect && authFailureVerified && !stageForbidsReconnect;

  let guidanceSuppressedReason = null;
  if (errorAllowsReconnect && !authFailureVerified) {
    guidanceSuppressedReason = "auth_failure_not_verified";
  } else if (stageForbidsReconnect) {
    guidanceSuppressedReason = "stage_forbids_reconnect";
  } else if (!guidance.reconnect_required) {
    guidanceSuppressedReason = "contract_does_not_require_reconnect";
  } else if (!allowedErrorCodeSet.has(errorCode)) {
    guidanceSuppressedReason = "error_code_not_allowed";
  }

  return {
    error_code: errorCode,
    http_status: guidance.http_status,
    source_stage: guidance.stage,
    stage_classification: guidance.stage_classification,
    retryable: guidance.retryable,
    reconnect_required: reconnectRequired,
    user_action:
      errorAllowsReconnect && !authFailureVerified
        ? null
        : guidance.user_action,
    readback: guidance.readback,
    auth_failure_verified: authFailureVerified,
    guidance_suppressed_reason: guidanceSuppressedReason,
  };
}
