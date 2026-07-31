import assert from "node:assert/strict";
import { createExecutionCapsuleRolloutEvaluator } from "./contextKernel/integration/executionCapsuleRolloutEvaluator.js";

const certificationContext = Object.freeze({
  implementationRevision: "implementation-revision-a",
  policyRevision: "policy-revision-a",
  evidenceRevision: "evidence-revision-a",
});
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

assert.throws(() => createExecutionCapsuleRolloutEvaluator({ minimumSampleCount: 1 }));
assert.throws(() => createExecutionCapsuleRolloutEvaluator({ minimumSamplesPerRequiredLane: 1 }));
assert.throws(() => createExecutionCapsuleRolloutEvaluator({ requiredLanes: ["tenant_read"] }));
assert.throws(() => createExecutionCapsuleRolloutEvaluator({ minimumMedianImprovement: 0.39 }));
assert.throws(() => createExecutionCapsuleRolloutEvaluator({ minimumEnumerationReduction: 0.59 }));

const evaluator = createExecutionCapsuleRolloutEvaluator();
export const certifiedEvidence = evaluator.evaluate({
  samples,
  rollbackEvidence,
  certificationContext,
});
assert.equal(certifiedEvidence.contract, "mad4b.execution-capsule-rollout-certificate.v2");
assert.equal(certifiedEvidence.status, "certified");
assert.equal(certifiedEvidence.rolloutAllowed, true);
assert.equal(certifiedEvidence.legacyRetirementAllowed, true);
assert.deepEqual({ ...certifiedEvidence.certificationContext }, certificationContext);
assert.deepEqual(certifiedEvidence.laneSampleCounts, {
  admin_read: 2,
  governed_mutation: 2,
  tenant_read: 2,
});
assert(certifiedEvidence.medianImprovement >= 0.4);
assert(certifiedEvidence.enumerationReduction >= 0.6);
assert.equal(certifiedEvidence.parityFailures, 0);
assert.equal(certifiedEvidence.safetyViolations, 0);
assert(Object.isFrozen(certifiedEvidence));
assert(Object.isFrozen(certifiedEvidence.requiredLanes));
assert(Object.isFrozen(certifiedEvidence.certificationContext));

const blocked = evaluator.evaluate({
  samples: samples.map((sample, index) => index === 0
    ? { ...sample, parityMatch: false, connectionSubstituted: true }
    : sample),
  rollbackEvidence,
  certificationContext,
});
assert.equal(blocked.status, "blocked");
assert(blocked.reasonCodes.includes("execution_capsule_rollout_parity_failed"));
assert(blocked.reasonCodes.includes("execution_capsule_rollout_safety_violation"));

const duplicateSample = evaluator.evaluate({
  samples: samples.map((sample, index) => index === 1
    ? { ...sample, sampleRef: samples[0].sampleRef }
    : sample),
  rollbackEvidence,
  certificationContext,
});
assert(duplicateSample.reasonCodes.includes("execution_capsule_rollout_duplicate_sample_ref"));

const underrepresentedLane = evaluator.evaluate({
  samples: samples.map((sample, index) => index === 1
    ? { ...sample, lane: "admin_read" }
    : sample),
  rollbackEvidence,
  certificationContext,
});
assert(underrepresentedLane.reasonCodes.includes(
  "execution_capsule_rollout_required_lane_underrepresented",
));

const weakPerformance = evaluator.evaluate({
  samples: samples.map((sample) => ({
    ...sample,
    capsuleDurationMs: 90,
    capsuleCandidateEnumerations: 8,
  })),
  rollbackEvidence,
  certificationContext,
});
assert(weakPerformance.reasonCodes.includes("execution_capsule_rollout_performance_floor_not_met"));
assert(weakPerformance.reasonCodes.includes("execution_capsule_rollout_enumeration_floor_not_met"));

const unsafeRollback = evaluator.evaluate({
  samples,
  rollbackEvidence: { ...rollbackEvidence, failClosedWhenGuardUnavailable: false },
  certificationContext,
});
assert(unsafeRollback.reasonCodes.includes("execution_capsule_rollout_rollback_not_safe"));

console.log("Execution Capsule EC5 rollout evaluator tests passed.");
