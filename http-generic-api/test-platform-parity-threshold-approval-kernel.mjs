import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_PARITY_THRESHOLDS,
  PARITY_THRESHOLD_TYPED_CONFIRMATION,
  approveParityThresholdPolicy,
  evaluateParityThresholdEvidence,
} from "./platformParityThresholdApprovalKernel.js";

const docs = fs.readFileSync(
  new URL("../docs/platform-parity-threshold-approval-kernel.md", import.meta.url),
  "utf8",
);
const tasks = fs.readFileSync(
  new URL("../specs/006-adaptive-authorization-execution-governance/tasks.md", import.meta.url),
  "utf8",
);
const strategy = fs.readFileSync(
  new URL("../specs/006-adaptive-authorization-execution-governance/testing-and-parity-strategy.md", import.meta.url),
  "utf8",
);

assert.equal(DEFAULT_PARITY_THRESHOLDS.crossTenantDenialPassRateMin, 1);
assert.equal(DEFAULT_PARITY_THRESHOLDS.replayAndStaleEnvelopePassRateMin, 1);
assert.equal(DEFAULT_PARITY_THRESHOLDS.unresolvedCriticalPrivilegeExpansionMax, 0);
assert.equal(DEFAULT_PARITY_THRESHOLDS.deterministicDecisionRepeatabilityMin, 0.999);
assert.equal(DEFAULT_PARITY_THRESHOLDS.credentialLeakageFindingsMax, 0);
assert.equal(DEFAULT_PARITY_THRESHOLDS.unresolvedAmbiguousAdapterSelectionMax, 0);

const approvedPolicy = approveParityThresholdPolicy({
  typedConfirmation: PARITY_THRESHOLD_TYPED_CONFIRMATION,
  policyVersion: "t042-v1",
  approvalId: "approval-t042-001",
  approvedBy: "platform-security-review",
  approvedAt: "2026-07-11T09:00:00Z",
  expiresAt: "2026-08-10T09:00:00Z",
  thresholdPolicyHash: "a".repeat(64),
  classificationEvidenceHash: "b".repeat(64),
});

assert.equal(approvedPolicy.approvalStatus, "approved_for_canary_evaluation_only");
assert.equal(approvedPolicy.canaryActivationAllowed, false);
assert.equal(approvedPolicy.providerApplyAllowed, false);
assert.equal(approvedPolicy.migrationExecutionAuthorized, false);

const passingEvidence = {
  crossTenantDenialPassRate: 1,
  replayAndStaleEnvelopePassRate: 1,
  unresolvedCriticalPrivilegeExpansionCount: 0,
  deterministicDecisionRepeatability: 0.9995,
  credentialLeakageFindingCount: 0,
  stateChangingPilotIdempotencyReadbackRate: 1,
  unresolvedAmbiguousAdapterSelectionCount: 0,
  decisionLatencySloMet: true,
  reconciliationLagWithinPolicy: true,
  securityReviewComplete: true,
  rollbackReadbackEvidenceApproved: true,
};

const passing = evaluateParityThresholdEvidence({
  approvedPolicy,
  evaluatedAt: "2026-07-12T09:00:00Z",
  evidenceHash: "c".repeat(64),
  evidence: passingEvidence,
});

assert.equal(passing.ok, true);
assert.equal(passing.eligibleForCanaryEvaluation, true);
assert.deepEqual(passing.failedChecks, []);
assert.equal(passing.canaryActivationAllowed, false);
assert.equal(passing.enforcementCutover, false);
assert.equal(passing.nextRequiredAction, "separate_explicit_canary_authority_required");

const repeatabilityFailure = evaluateParityThresholdEvidence({
  approvedPolicy,
  evaluatedAt: "2026-07-12T09:00:00Z",
  evidenceHash: "d".repeat(64),
  evidence: { ...passingEvidence, deterministicDecisionRepeatability: 0.9989 },
});
assert.equal(repeatabilityFailure.ok, false);
assert.deepEqual(repeatabilityFailure.failedChecks, ["decision_repeatability"]);

const criticalExpansionFailure = evaluateParityThresholdEvidence({
  approvedPolicy,
  evaluatedAt: "2026-07-12T09:00:00Z",
  evidenceHash: "e".repeat(64),
  evidence: { ...passingEvidence, unresolvedCriticalPrivilegeExpansionCount: 1 },
});
assert.equal(criticalExpansionFailure.ok, false);
assert.deepEqual(criticalExpansionFailure.failedChecks, ["critical_privilege_expansion"]);

const leakageFailure = evaluateParityThresholdEvidence({
  approvedPolicy,
  evaluatedAt: "2026-07-12T09:00:00Z",
  evidenceHash: "f".repeat(64),
  evidence: { ...passingEvidence, credentialLeakageFindingCount: 1 },
});
assert.equal(leakageFailure.ok, false);
assert.deepEqual(leakageFailure.failedChecks, ["credential_leakage"]);

const expired = evaluateParityThresholdEvidence({
  approvedPolicy,
  evaluatedAt: "2026-09-12T09:00:00Z",
  evidenceHash: "1".repeat(64),
  evidence: passingEvidence,
});
assert.equal(expired.ok, false);
assert.equal(expired.approvalExpired, true);
assert.equal(expired.canaryActivationAllowed, false);

assert.throws(
  () =>
    approveParityThresholdPolicy({
      typedConfirmation: "APPROVE_CANARY_NOW",
      policyVersion: "t042-v1",
      approvalId: "bad",
      approvedBy: "bad",
      approvedAt: "2026-07-11T09:00:00Z",
      expiresAt: "2026-08-10T09:00:00Z",
      thresholdPolicyHash: "a".repeat(64),
      classificationEvidenceHash: "b".repeat(64),
    }),
  /Typed confirmation/,
);

assert(tasks.includes("- [x] T042 Approve parity thresholds before canary enforcement."));
assert(strategy.includes("at least 99.9% deterministic decision repeatability"));
assert(strategy.includes("A global parity percentage alone is insufficient."));
assert(docs.includes("canaryActivationAllowed: false"));
assert(docs.includes("separate explicit canary authority"));

console.log("platform parity threshold approval kernel tests passed");
