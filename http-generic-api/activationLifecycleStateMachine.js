const freezeList = (values) => Object.freeze([...values]);

function freezeTransitions(transitions) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(transitions).map(([state, targets]) => [
        state,
        freezeList(targets),
      ]),
    ),
  );
}

export const ACTIVATION_OPERATION_STATUSES = freezeList([
  "created",
  "authenticating",
  "authorized",
  "resolving_session",
  "bootstrapping",
  "validating",
  "preparing_tools",
  "ready",
  "active",
  "executing",
  "readback_pending",
  "delivery_pending",
  "acknowledgement_pending",
  "retry_scheduled",
  "unknown_outcome",
  "reconciling",
  "degraded",
  "authorization_gated",
  "validation_rate_limited",
  "contract_degraded",
  "failed",
  "cancelled",
  "rolled_back",
]);

export const ACTIVATION_OPERATION_CORE_NONTERMINAL_STATES = freezeList([
  "created",
  "authenticating",
  "authorized",
  "resolving_session",
  "bootstrapping",
  "validating",
  "preparing_tools",
  "ready",
  "executing",
  "readback_pending",
  "retry_scheduled",
  "unknown_outcome",
  "reconciling",
]);

export const ACTIVATION_OPERATION_AGGREGATE_OVERLAY_STATES = freezeList([
  "delivery_pending",
  "acknowledgement_pending",
]);

export const ACTIVATION_OPERATION_STABLE_REPORTED_STATES = freezeList([
  "active",
  "degraded",
  "authorization_gated",
  "validation_rate_limited",
  "contract_degraded",
  "failed",
  "cancelled",
  "rolled_back",
]);

export const ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY = freezeList([
  "active",
  "cancelled",
  "rolled_back",
]);

export const ACTIVATION_OPERATION_STABLE_RETRY_STATES = freezeList([
  "degraded",
  "authorization_gated",
  "validation_rate_limited",
  "contract_degraded",
  "failed",
]);

export const ACTIVATION_OPERATION_TRANSITIONS = freezeTransitions({
  created: ["authenticating", "authorized", "cancelled"],
  authenticating: ["authorized", "authorization_gated", "failed", "cancelled"],
  authorized: ["resolving_session", "cancelled"],
  resolving_session: ["bootstrapping", "authorization_gated", "degraded", "cancelled"],
  bootstrapping: ["validating", "preparing_tools", "ready", "degraded", "cancelled"],
  validating: [
    "preparing_tools",
    "ready",
    "degraded",
    "validation_rate_limited",
    "contract_degraded",
    "cancelled",
  ],
  preparing_tools: ["ready", "degraded", "contract_degraded", "cancelled"],
  ready: ["active", "executing", "cancelled"],
  executing: ["readback_pending", "unknown_outcome", "failed", "cancelled"],
  readback_pending: ["active", "degraded", "failed", "unknown_outcome"],
  unknown_outcome: ["reconciling"],
  reconciling: ["active", "degraded", "failed", "unknown_outcome"],
  retry_scheduled: [
    "authenticating",
    "resolving_session",
    "bootstrapping",
    "validating",
    "preparing_tools",
    "executing",
    "reconciling",
  ],
});

export const ACTIVATION_STAGE_ATTEMPT_STATUSES = freezeList([
  "pending",
  "running",
  "succeeded",
  "degraded",
  "failed",
  "unknown_outcome",
  "cancelled",
]);

export const ACTIVATION_STAGE_ATTEMPT_TRANSITIONS = freezeTransitions({
  pending: ["running", "cancelled"],
  running: ["succeeded", "degraded", "failed", "unknown_outcome", "cancelled"],
});

export const ACTIVATION_STAGE_ATTEMPT_TERMINAL_STATES = freezeList([
  "succeeded",
  "degraded",
  "failed",
  "unknown_outcome",
  "cancelled",
]);

const operationStatusSet = new Set(ACTIVATION_OPERATION_STATUSES);
const coreNonterminalSet = new Set(ACTIVATION_OPERATION_CORE_NONTERMINAL_STATES);
const aggregateOverlaySet = new Set(ACTIVATION_OPERATION_AGGREGATE_OVERLAY_STATES);
const stableReportedSet = new Set(ACTIVATION_OPERATION_STABLE_REPORTED_STATES);
const terminalWithoutRetrySet = new Set(ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY);
const stableRetrySet = new Set(ACTIVATION_OPERATION_STABLE_RETRY_STATES);
const stageAttemptStatusSet = new Set(ACTIVATION_STAGE_ATTEMPT_STATUSES);
const stageAttemptTerminalSet = new Set(ACTIVATION_STAGE_ATTEMPT_TERMINAL_STATES);

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeStatus(value, field, allowed, code) {
  const status = String(value ?? "").trim();
  if (!allowed.has(status)) {
    fail(code, `${field} is not a declared Activation lifecycle status.`, 400, {
      field,
      value: status || null,
    });
  }
  return status;
}

export function classifyActivationOperationState(status) {
  const normalized = normalizeStatus(
    status,
    "operation_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  if (coreNonterminalSet.has(normalized)) return "core_nonterminal";
  if (aggregateOverlaySet.has(normalized)) return "aggregate_overlay";
  if (stableReportedSet.has(normalized)) return "stable_reported";
  fail(
    "activation_operation_state_classification_missing",
    `No lifecycle classification exists for ${normalized}.`,
    500,
  );
}

export function getAllowedActivationOperationTransitions(status) {
  const normalized = normalizeStatus(
    status,
    "operation_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  return [...(ACTIVATION_OPERATION_TRANSITIONS[normalized] || [])];
}

export function isActivationOperationTerminalWithoutRetry(status) {
  const normalized = normalizeStatus(
    status,
    "operation_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  return terminalWithoutRetrySet.has(normalized);
}

export function isActivationOperationStableRetryState(status) {
  const normalized = normalizeStatus(
    status,
    "operation_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  return stableRetrySet.has(normalized);
}

export function assertActivationOperationTransition(fromStatus, toStatus) {
  const from = normalizeStatus(
    fromStatus,
    "from_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  const to = normalizeStatus(
    toStatus,
    "to_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );

  if (aggregateOverlaySet.has(from) || aggregateOverlaySet.has(to)) {
    fail(
      "activation_operation_overlay_transition_invalid",
      "Aggregate delivery and acknowledgement overlays cannot rewrite the core operation state.",
      409,
      { from, to },
    );
  }
  if (terminalWithoutRetrySet.has(from)) {
    fail(
      "activation_operation_terminal",
      `Activation operation is terminal without retry in state ${from}.`,
      409,
      { from, to },
    );
  }
  if (stableRetrySet.has(from)) {
    fail(
      "activation_operation_governed_retry_required",
      `Activation operation state ${from} requires a governed retry request.`,
      409,
      { from, to },
    );
  }
  if (!ACTIVATION_OPERATION_TRANSITIONS[from]?.includes(to)) {
    fail(
      "activation_operation_transition_invalid",
      `Invalid Activation operation transition from ${from} to ${to}.`,
      409,
      { from, to },
    );
  }
  return { allowed: true, from_status: from, to_status: to };
}

export function applyActivationAggregateOverlay(operationStatus, overlayStatus) {
  const operation = normalizeStatus(
    operationStatus,
    "operation_status",
    operationStatusSet,
    "activation_operation_status_invalid",
  );
  const overlay = normalizeStatus(
    overlayStatus,
    "overlay_status",
    aggregateOverlaySet,
    "activation_operation_overlay_status_invalid",
  );
  if (aggregateOverlaySet.has(operation)) {
    fail(
      "activation_operation_overlay_base_invalid",
      "An aggregate overlay cannot be used as the underlying operation state.",
      409,
      { operation_status: operation, overlay_status: overlay },
    );
  }
  return {
    operation_status: operation,
    overlay_status: overlay,
    execution_outcome_rewritten: false,
  };
}

export function getAllowedActivationStageAttemptTransitions(status) {
  const normalized = normalizeStatus(
    status,
    "stage_attempt_status",
    stageAttemptStatusSet,
    "activation_stage_attempt_status_invalid",
  );
  return [...(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS[normalized] || [])];
}

export function isActivationStageAttemptTerminal(status) {
  const normalized = normalizeStatus(
    status,
    "stage_attempt_status",
    stageAttemptStatusSet,
    "activation_stage_attempt_status_invalid",
  );
  return stageAttemptTerminalSet.has(normalized);
}

export function assertActivationStageAttemptTransition(fromStatus, toStatus) {
  const from = normalizeStatus(
    fromStatus,
    "from_status",
    stageAttemptStatusSet,
    "activation_stage_attempt_status_invalid",
  );
  const to = normalizeStatus(
    toStatus,
    "to_status",
    stageAttemptStatusSet,
    "activation_stage_attempt_status_invalid",
  );
  if (stageAttemptTerminalSet.has(from)) {
    fail(
      "activation_stage_attempt_terminal",
      `Activation stage attempt is terminal in state ${from}.`,
      409,
      { from, to },
    );
  }
  if (!ACTIVATION_STAGE_ATTEMPT_TRANSITIONS[from]?.includes(to)) {
    fail(
      "activation_stage_attempt_transition_invalid",
      `Invalid Activation stage attempt transition from ${from} to ${to}.`,
      409,
      { from, to },
    );
  }
  return { allowed: true, from_status: from, to_status: to };
}
