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

  return Object.freeze({
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
  });
}
