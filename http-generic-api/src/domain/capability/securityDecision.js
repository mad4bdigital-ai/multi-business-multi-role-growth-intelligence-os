import { CapabilityDomainError } from "./canonicalCapability.js";

export const GATE_STATES = Object.freeze(["pass", "deny", "not_applicable", "not_evaluated"]);
export const SECURITY_DECISION_OUTCOMES = Object.freeze(["allow", "deny"]);
export const EXECUTION_MODES = Object.freeze(["preview", "dispatch"]);

const GATE_STATE_SET = new Set(GATE_STATES);
const EXECUTION_MODE_SET = new Set(EXECUTION_MODES);

function clean(value) {
  return String(value || "").trim();
}

function bool(value) {
  return value === true;
}

function freezeTraceEvent(event) {
  return Object.freeze({
    type: event.type,
    gate_key: event.gate_key,
    required: event.required,
    state: event.state,
    evaluated: event.evaluated,
    reason: event.reason,
    code: event.code,
    detail_keys: Object.freeze(event.detail_keys || []),
  });
}

export function createGateResult(input = {}) {
  const key = clean(input.key);
  const state = clean(input.state || "not_evaluated");
  if (!key) throw new CapabilityDomainError("MISSING_GATE_KEY", "Gate key is required.");
  if (!GATE_STATE_SET.has(state)) {
    throw new CapabilityDomainError("INVALID_GATE_STATE", "Unsupported gate state.", { key, state });
  }
  return Object.freeze({
    key,
    required: input.required !== false,
    state,
    reason: clean(input.reason || state),
    code: input.code ? clean(input.code) : null,
    evaluated: state !== "not_evaluated",
    details: input.details && typeof input.details === "object" ? Object.freeze({ ...input.details }) : null,
  });
}

export function gateFromBoolean({ key, ok, required = true, reason, denyCode = null, notApplicable = false }) {
  if (notApplicable) {
    return createGateResult({ key, required, state: "not_applicable", reason: reason || "not_applicable" });
  }
  return createGateResult({
    key,
    required,
    state: bool(ok) ? "pass" : "deny",
    reason: reason || (bool(ok) ? "passed" : "denied"),
    code: bool(ok) ? null : denyCode,
  });
}

export function createSecurityDecisionTrace(input = {}) {
  const gates = Array.isArray(input.gates) ? input.gates : [];
  const invariants = input.invariants && typeof input.invariants === "object" ? input.invariants : {};
  return Object.freeze({
    schema_version: "security_decision_trace.v1",
    trace_id: input.trace_id ? clean(input.trace_id) : null,
    outcome: input.outcome,
    allowed: Boolean(input.allowed),
    dispatch_ready: Boolean(input.dispatch_ready),
    will_execute: Boolean(input.will_execute),
    execution_mode: input.execution_mode,
    approval_required: Boolean(input.approval_required),
    denied_gates: Object.freeze([...(input.denied_gates || [])]),
    unevaluated_required_gates: Object.freeze([...(input.unevaluated_required_gates || [])]),
    gate_events: Object.freeze(gates.map((gate) => freezeTraceEvent({
      type: "gate_evaluated",
      gate_key: gate.key,
      required: gate.required,
      state: gate.state,
      evaluated: gate.evaluated,
      reason: gate.reason,
      code: gate.code,
      detail_keys: gate.details ? Object.keys(gate.details).sort() : [],
    }))),
    invariant_results: Object.freeze(Object.fromEntries(Object.entries(invariants).sort())),
    secrets_included: false,
  });
}

export function projectSecurityDecisionTrace(trace = null, { audience = "public" } = {}) {
  if (!trace || typeof trace !== "object") return null;
  const admin = audience === "admin";
  return Object.freeze({
    schema_version: trace.schema_version || "security_decision_trace.v1",
    trace_id: trace.trace_id || null,
    outcome: trace.outcome,
    allowed: Boolean(trace.allowed),
    dispatch_ready: Boolean(trace.dispatch_ready),
    will_execute: Boolean(trace.will_execute),
    execution_mode: trace.execution_mode,
    approval_required: Boolean(trace.approval_required),
    denied_gate_count: Array.isArray(trace.denied_gates) ? trace.denied_gates.length : 0,
    unevaluated_required_gate_count: Array.isArray(trace.unevaluated_required_gates) ? trace.unevaluated_required_gates.length : 0,
    gate_events: Object.freeze((Array.isArray(trace.gate_events) ? trace.gate_events : []).map((event) => Object.freeze({
      type: event.type,
      gate_key: event.gate_key,
      required: event.required,
      state: event.state,
      evaluated: event.evaluated,
      ...(admin ? {
        reason: event.reason,
        code: event.code,
        detail_keys: Object.freeze(event.detail_keys || []),
      } : {}),
    }))),
    ...(admin ? {
      denied_gates: Object.freeze([...(trace.denied_gates || [])]),
      unevaluated_required_gates: Object.freeze([...(trace.unevaluated_required_gates || [])]),
      invariant_results: Object.freeze({ ...(trace.invariant_results || {}) }),
    } : {}),
    secrets_included: false,
  });
}

export function deriveSecurityDecisionInvariantMetrics(decision = {}) {
  const invariants = decision.invariants && typeof decision.invariants === "object" ? decision.invariants : {};
  const violatedInvariants = Object.entries(invariants)
    .filter(([, passed]) => passed !== true)
    .map(([key]) => key);
  const deniedGates = Array.isArray(decision.denied_gates) ? decision.denied_gates : [];
  const unevaluatedRequiredGates = Array.isArray(decision.unevaluated_required_gates) ? decision.unevaluated_required_gates : [];
  return Object.freeze({
    schema_version: "security_decision_metrics.v1",
    decision_outcome: decision.outcome || null,
    allowed: Boolean(decision.allowed),
    dispatch_ready: Boolean(decision.dispatch_ready),
    will_execute: Boolean(decision.will_execute),
    denied_gate_count: deniedGates.length,
    unevaluated_required_gate_count: unevaluatedRequiredGates.length,
    invariant_violation_count: violatedInvariants.length,
    violated_invariants: Object.freeze(violatedInvariants),
    alert_level: violatedInvariants.length > 0 || unevaluatedRequiredGates.length > 0
      ? "critical"
      : (deniedGates.length > 0 ? "warning" : "none"),
    secrets_included: false,
  });
}

export function assertAllowedDecisionHasNoUnevaluatedRequiredGate(gates = []) {
  const unevaluated = gates.filter((gate) => gate.required && gate.state === "not_evaluated");
  if (unevaluated.length > 0) {
    throw new CapabilityDomainError(
      "SECURITY_DECISION_REQUIRED_GATE_NOT_EVALUATED",
      "Allowed security decisions cannot contain unevaluated required gates.",
      { gates: unevaluated.map((gate) => gate.key) }
    );
  }
}

export function createSecurityDecision(input = {}) {
  const executionMode = clean(input.execution_mode || input.executionMode || "preview");
  if (!EXECUTION_MODE_SET.has(executionMode)) {
    throw new CapabilityDomainError("INVALID_EXECUTION_MODE", "Unsupported execution mode.", { execution_mode: executionMode });
  }
  const gates = Object.freeze((Array.isArray(input.gates) ? input.gates : []).map((gate) => createGateResult(gate)));
  if (gates.length === 0) throw new CapabilityDomainError("SECURITY_DECISION_REQUIRES_GATES", "Security decisions require at least one gate.");

  const deniedGates = gates.filter((gate) => gate.required && gate.state === "deny");
  const unevaluatedRequiredGates = gates.filter((gate) => gate.required && gate.state === "not_evaluated");
  const allowed = deniedGates.length === 0 && unevaluatedRequiredGates.length === 0;
  if (allowed) assertAllowedDecisionHasNoUnevaluatedRequiredGate(gates);

  const approvalRequired = bool(input.approval_required || input.approvalRequired);
  const dispatchReady = Boolean(allowed && !approvalRequired && executionMode === "dispatch");
  const denialReasons = [
    ...deniedGates.map((gate) => gate.reason),
    ...unevaluatedRequiredGates.map((gate) => `${gate.key}_not_evaluated`),
  ];

  const decision = {
    outcome: allowed ? "allow" : "deny",
    allowed,
    dispatch_ready: dispatchReady,
    will_execute: dispatchReady,
    execution_mode: executionMode,
    approval_required: approvalRequired,
    reason: allowed ? "resolved" : [...new Set(denialReasons)].join("|"),
    gates,
    denied_gates: deniedGates.map((gate) => gate.key),
    unevaluated_required_gates: unevaluatedRequiredGates.map((gate) => gate.key),
    invariants: Object.freeze({
      fail_closed_on_unevaluated_required_gate: unevaluatedRequiredGates.length === 0,
      preview_mode_cannot_execute: executionMode !== "preview" || dispatchReady === false,
      dispatch_ready_requires_allowed_without_approval: dispatchReady === Boolean(allowed && !approvalRequired && executionMode === "dispatch"),
    }),
  };
  decision.trace = createSecurityDecisionTrace({
    ...decision,
    trace_id: input.trace_id || input.traceId || null,
  });
  decision.metrics = deriveSecurityDecisionInvariantMetrics(decision);
  return Object.freeze(decision);
}
