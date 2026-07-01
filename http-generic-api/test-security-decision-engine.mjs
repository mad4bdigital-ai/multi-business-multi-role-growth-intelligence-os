import assert from "node:assert/strict";
import {
  assertAllowedDecisionHasNoUnevaluatedRequiredGate,
  createGateResult,
  createSecurityDecision,
  gateFromBoolean,
} from "./src/domain/capability/securityDecision.js";

{
  const gate = createGateResult({ key: "principal", state: "pass", reason: "tenant_authorized" });
  assert.equal(gate.key, "principal");
  assert.equal(gate.required, true);
  assert.equal(gate.evaluated, true);
  assert.equal(gate.state, "pass");
}

{
  const decision = createSecurityDecision({
    execution_mode: "dispatch",
    gates: [
      gateFromBoolean({ key: "principal", ok: true }),
      gateFromBoolean({ key: "surface", ok: true }),
      gateFromBoolean({ key: "target", ok: true }),
      gateFromBoolean({ key: "skill", ok: true }),
      gateFromBoolean({ key: "policy", ok: true }),
    ],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.dispatch_ready, true);
  assert.equal(decision.will_execute, true);
  assert.equal(decision.invariants.dispatch_ready_requires_allowed_without_approval, true);
}

{
  const decision = createSecurityDecision({
    execution_mode: "dispatch",
    gates: [
      gateFromBoolean({ key: "principal", ok: true }),
      gateFromBoolean({ key: "surface", ok: false, reason: "admin_tool_forbidden", denyCode: "SURFACE_DENIED" }),
    ],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.dispatch_ready, false);
  assert.deepEqual(decision.denied_gates, ["surface"]);
  assert.match(decision.reason, /admin_tool_forbidden/);
}

{
  const decision = createSecurityDecision({
    execution_mode: "dispatch",
    gates: [
      gateFromBoolean({ key: "principal", ok: true }),
      { key: "credential", required: true, state: "not_evaluated", reason: "blocked_before_credential_lookup" },
    ],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.dispatch_ready, false);
  assert.deepEqual(decision.unevaluated_required_gates, ["credential"]);
  assert.equal(decision.invariants.fail_closed_on_unevaluated_required_gate, false);
}

{
  const decision = createSecurityDecision({
    execution_mode: "preview",
    gates: [
      gateFromBoolean({ key: "principal", ok: true }),
      gateFromBoolean({ key: "surface", ok: true }),
    ],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.dispatch_ready, false);
  assert.equal(decision.will_execute, false);
  assert.equal(decision.invariants.preview_mode_cannot_execute, true);
}

{
  assert.throws(
    () => assertAllowedDecisionHasNoUnevaluatedRequiredGate([
      createGateResult({ key: "policy", required: true, state: "not_evaluated" }),
    ]),
    (err) => err?.code === "SECURITY_DECISION_REQUIRED_GATE_NOT_EVALUATED",
  );
}

console.log("security decision engine tests passed");
