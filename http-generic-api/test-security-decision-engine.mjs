import assert from "node:assert/strict";
import {
  assertAllowedDecisionHasNoUnevaluatedRequiredGate,
  createGateResult,
  createSecurityDecision,
  gateFromBoolean,
} from "./src/domain/capability/securityDecision.js";
import {
  evaluatePolicyCompleteness,
  evaluatePrincipalTenantAuthorization,
  evaluateSkillGate,
  evaluateSurfaceExposure,
  evaluateTargetResourceOwnership,
} from "./src/domain/capability/securityEvaluators.js";
import {
  buildPlatformPluginPreApprovalDecision,
  buildPlatformPluginSecurityDecision,
} from "./src/application/capability/platformPluginSecurityDecisionUseCase.js";

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

{
  const gateStates = ["pass", "deny", "not_applicable", "not_evaluated"];
  for (const state of gateStates) {
    for (const required of [true, false]) {
      for (const approvalRequired of [true, false]) {
        for (const executionMode of ["preview", "dispatch"]) {
          const decision = createSecurityDecision({
            execution_mode: executionMode,
            approval_required: approvalRequired,
            gates: [
              createGateResult({ key: "principal_scope", state: "pass" }),
              createGateResult({ key: "matrix_gate", state, required }),
            ],
          });
          const blocksAllowed = required && (state === "deny" || state === "not_evaluated");
          assert.equal(decision.allowed, !blocksAllowed);
          assert.equal(decision.will_execute, decision.dispatch_ready);
          assert.equal(
            decision.dispatch_ready,
            decision.allowed && !approvalRequired && executionMode === "dispatch",
          );
          if (required && state === "not_evaluated") {
            assert.deepEqual(decision.unevaluated_required_gates, ["matrix_gate"]);
          }
          if (required && state === "deny") {
            assert.deepEqual(decision.denied_gates, ["matrix_gate"]);
          }
        }
      }
    }
  }
}

{
  assert.equal(evaluatePrincipalTenantAuthorization({ principalClass: "tenant" }).state, "deny");
  assert.equal(
    evaluatePrincipalTenantAuthorization({ principalClass: "tenant", tenantId: "tenant-1", userId: "user-1" }).state,
    "pass",
  );
  assert.equal(evaluatePrincipalTenantAuthorization({ principalClass: "admin" }).state, "pass");
}

{
  const blocked = evaluateSurfaceExposure({
    selectorType: "tool_key",
    toolSurface: "admin_platform_tool",
    exposureScope: "tenant",
    principalClass: "tenant",
  });
  assert.equal(blocked.state, "deny");
  assert.equal(blocked.reason, "admin_tool_forbidden");
  assert.equal(
    evaluateSurfaceExposure({ selectorType: "action_key", principalClass: "tenant" }).state,
    "pass",
  );
}

{
  assert.equal(evaluateTargetResourceOwnership({ required: false, state: "not_applicable" }).state, "not_applicable");
  assert.equal(evaluateTargetResourceOwnership({ ok: false, reason: "target_owner_mismatch" }).state, "deny");
  assert.equal(evaluateSkillGate({ required: false, granted: true }).state, "not_applicable");
  assert.equal(evaluateSkillGate({ required: true, granted: false, reason: "skill_not_granted" }).state, "deny");
  assert.equal(evaluatePolicyCompleteness({ ready: false, reason: "mutation_policy_missing" }).state, "deny");
}

{
  const preApproval = buildPlatformPluginPreApprovalDecision({
    selector: { type: "action_key", value: "github.repo.read" },
    binding: { binding_role: "primary_api", status: "active" },
    pluginStatusActive: true,
    principalClass: "tenant",
    tenantId: "tenant-1",
    userId: "user-1",
    bindingState: { ok: true, reason: "binding_active" },
    canonicalPolicy: { ready: true, reason: "action_is_canonical_policy_key" },
    credential: { ok: true, reason: "connection_available" },
    credentialDecisionEvaluated: true,
    targetAuthority: { ok: true, required: false, state: "not_applicable", reason: "target_authority_not_required" },
    skill: { required: true, granted: true, reason: "skill_granted" },
    smokeCertification: { certified: true, reason: "smoke_certification_active" },
  });
  assert.equal(preApproval.allowed, true);
  assert.equal(preApproval.dispatch_ready, true);

  const approvalBlocked = buildPlatformPluginSecurityDecision({
    preApprovalDecision: preApproval,
    approvalRequired: true,
    baseApprovalRequired: true,
    actionGrant: { reason: "action_grant_required" },
  });
  assert.equal(approvalBlocked.allowed, false);
  assert.equal(approvalBlocked.approval_required, true);
  assert.equal(approvalBlocked.dispatch_ready, false);
  assert.deepEqual(approvalBlocked.denied_gates, ["approval"]);
}

console.log("security decision engine tests passed");
