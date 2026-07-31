import assert from "node:assert/strict";
import { createExecutionCapsuleRolloutEvaluator } from "./contextKernel/integration/executionCapsuleRolloutEvaluator.js";

const evaluator = createExecutionCapsuleRolloutEvaluator();
const lanes = ["tenant_read", "admin_read", "governed_mutation"];
const samples = lanes.flatMap((lane, laneIndex) => [0, 1].map((sampleIndex) => ({
  sampleRef: `${lane}-${sampleIndex + 1}`,
  lane,
  legacyDurationMs: 100 + laneIndex,
  capsuleDurationMs: 45 + sampleIndex,
  legacyCandidateEnumerations: 10,
  capsuleCandidateEnumerations: 3,
  parityMatch: true,
  exactTargetRetained: true,
  authoritySafe: true,
  staleAuthorityAccepted: false,
  ambiguitySuppressed: false,
  crossTenantAccess: false,
  connectionSubstituted: false,
})));
const rollbackEvidence = Object.freeze({
  exactOwnerIsolationRetained: true,
  failClosedWhenGuardUnavailable: true,
  legacyResolverRestorable: true,
  providerDispatchPerformed: false,
  databaseWritePerformed: false,
  credentialMutationPerformed: false,
});

export const certifiedEvidence = evaluator.evaluate({ samples, rollbackEvidence });
assert.equal(certifiedEvidence.status, "certified");
assert.equal(certifiedEvidence.rolloutAllowed, true);
assert.equal(certifiedEvidence.legacyRetirementAllowed, true);
assert(certifiedEvidence.medianImprovement >= 0.4);
assert(certifiedEvidence.enumerationReduction >= 0.6);
assert.equal(certifiedEvidence.parityFailures, 0);
assert.equal(certifiedEvidence.safetyViolations, 0);
assert(Object.isFrozen(certifiedEvidence));
assert(Object.isFrozen(certifiedEvidence.requiredLanes));

const blocked = evaluator.evaluate({
  samples: samples.map((sample, index) => index === 0
    ? { ...sample, parityMatch: false, connectionSubstituted: true }
    : sample),
  rollbackEvidence,
});
assert.equal(blocked.status, "blocked");
assert(blocked.reasonCodes.includes("execution_capsule_rollout_parity_failed"));
assert(blocked.reasonCodes.includes("execution_capsule_rollout_safety_violation"));

const weakPerformance = evaluator.evaluate({
  samples: samples.map((sample) => ({
    ...sample,
    capsuleDurationMs: 90,
    capsuleCandidateEnumerations: 8,
  })),
  rollbackEvidence,
});
assert(weakPerformance.reasonCodes.includes("execution_capsule_rollout_performance_floor_not_met"));
assert(weakPerformance.reasonCodes.includes("execution_capsule_rollout_enumeration_floor_not_met"));

const unsafeRollback = evaluator.evaluate({
  samples,
  rollbackEvidence: { ...rollbackEvidence, failClosedWhenGuardUnavailable: false },
});
assert(unsafeRollback.reasonCodes.includes("execution_capsule_rollout_rollback_not_safe"));

console.log("Execution Capsule EC5 rollout evaluator tests passed.");
