import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsule } from "./contextKernel/domain/executionCapsule.js";
import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";
import {
  ExecutionCapsuleMutationDispatchError,
  ExecutionCapsuleRuntimeRolloutStatus,
  computeExecutionCapsuleRuntimeMetricsDigest,
  createExecutionCapsuleMutationDispatchGate,
  createExecutionCapsuleRuntimeRolloutGate,
  evaluateExecutionCapsuleRuntimeRollout,
} from "./contextKernel/integration/index.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";
const VALIDATED_AT = "2030-01-01T00:05:00.000Z";
const EXPIRES_AT = "2030-01-01T00:10:00.000Z";

function sha256Digest(value) {
  return `sha256-${createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function independentMetricsDigest(metrics) {
  return sha256Digest({
    schemaVersion: "execution-capsule-runtime-metrics-v1",
    metrics: {
      medianResolutionImprovementPct: metrics.medianResolutionImprovementPct,
      candidateEnumerationReductionPct: metrics.candidateEnumerationReductionPct,
      parityRatePct: metrics.parityRatePct,
      coveredOperationRatePct: metrics.coveredOperationRatePct,
      ambiguitySuppressionIncrease: metrics.ambiguitySuppressionIncrease,
      crossTenantAccessIncrease: metrics.crossTenantAccessIncrease,
      connectionSubstitutionIncrease: metrics.connectionSubstitutionIncrease,
      staleAuthorityAcceptanceIncrease: metrics.staleAuthorityAcceptanceIncrease,
      readPilotPassed: metrics.readPilotPassed,
      mutationPilotPassed: metrics.mutationPilotPassed,
      rollbackDrillPassed: metrics.rollbackDrillPassed,
      exactHeadCiPassed: metrics.exactHeadCiPassed,
      humanReviewPassed: metrics.humanReviewPassed,
    },
  });
}

function independentRetirementPlanDigest(plan) {
  return sha256Digest({
    schemaVersion: "execution-capsule-runtime-retirement-plan-v1",
    retirementPlan: {
      planRef: plan.planRef,
      replacementResolverKey: plan.replacementResolverKey,
      rollbackRef: plan.rollbackRef,
      metricsEvidenceRef: plan.metricsEvidenceRef,
      metricsEvidenceRevision: plan.metricsEvidenceRevision,
      metricsDigest: plan.metricsDigest,
      legacyResolverKeys: [...plan.legacyResolverKeys].sort(),
    },
  });
}

const capsule = createExecutionCapsule({
  contextHash: "context-hash-mutation-a",
  contextRevision: "context-revision-mutation-a",
  principalType: "tenant_user",
  principalRef: "principal-a",
  effectiveSubjectRef: "subject-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  brandRef: "brand-a",
  resourceType: "repository",
  resourceRef: "repository-a",
  connectionRef: "connection-a",
  authorityPathRef: "authority-path-a",
  capabilityKey: "repository.branch.update",
  authorityRevision: "authority-revision-a",
  capabilityRevision: "capability-revision-a",
  registryRevision: "registry-revision-a",
  credentialReadinessRevision: "credential-readiness-revision-a",
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
  invalidationDependencies: [],
});
const currentContext = Object.freeze({
  contextHash: capsule.contextHash,
  contextRevision: capsule.contextRevision,
  principal: {
    principalType: capsule.principalType,
    principalRef: capsule.principalRef,
  },
  effectiveSubject: { subjectRef: capsule.effectiveSubjectRef },
  tenantRef: capsule.tenantRef,
  workspaceRef: capsule.workspaceRef,
  brandRef: capsule.brandRef,
  resourceType: capsule.resourceType,
  resourceRef: capsule.resourceRef,
  connectionRef: capsule.connectionRef,
});
const currentDependencies = Object.freeze(
  capsule.invalidationDependencies.map((entry) => Object.freeze({ ...entry })),
);
const operationContract = Object.freeze({
  operationKey: "repository.branch.update",
  operationKind: "mutation",
  riskClass: "reversible_repository_mutation",
  mutationRequired: true,
  reversible: true,
  rollbackOperationKey: "repository.branch.restore",
  requiredDynamicEvidence: Object.freeze([
    "approval",
    "capability_envelope",
    "effective_authority",
    "resource_version",
    "provider_version",
    "connection_status",
    "expected_sha",
  ]),
});
const governanceDecision = Object.freeze({
  decisionRef: "governance-decision-a",
  decisionRevision: "governance-revision-a",
  operationKey: operationContract.operationKey,
  contextHash: capsule.contextHash,
  status: "allowed",
  dispatchAllowed: true,
  mutationAllowed: true,
});
const dispatchInput = Object.freeze({
  repositoryRef: "repository-a",
  branch: "feature-a",
  expectedSha: "abcdef1234567",
  targetSha: "abcdef7654321",
});
const evidenceStatuses = Object.freeze({
  approval: "approved",
  capability_envelope: "active",
  effective_authority: "active",
  resource_version: "current",
  provider_version: "current",
  connection_status: "active",
  expected_sha: "matched",
});

function dynamicItems(overrides = {}) {
  const result = {};
  for (const key of operationContract.requiredDynamicEvidence) {
    result[key] = {
      status: evidenceStatuses[key],
      revision: `${key}-revision-a`,
      evidenceRef: `${key}-evidence-a`,
      operationKey: operationContract.operationKey,
      contextHash: capsule.contextHash,
      tenantRef: capsule.tenantRef,
      workspaceRef: capsule.workspaceRef,
      resourceRef: capsule.resourceRef,
      connectionRef: capsule.connectionRef,
    };
  }
  result.expected_sha.expectedSha = "abcdef1234567";
  result.expected_sha.actualSha = "abcdef1234567";
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = { ...result[key], ...value };
  }
  return result;
}

const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(VALIDATED_AT),
});
const legacyResult = Object.freeze({ status: "legacy-ok" });
const legacyInputs = [];
const disabledGate = createExecutionCapsuleMutationDispatchGate({
  async dispatchMutationOperation(input) {
    legacyInputs.push(input);
    return legacyResult;
  },
});
assert.equal(disabledGate.enabled, false);
assert.equal(await disabledGate.dispatch({ dispatchInput }), legacyResult);
assert.equal(legacyInputs[0], dispatchInput);

const envelopes = [];
const events = [];
const mutationResult = Object.freeze({ status: "applied", rollbackRef: "rollback-a" });
const gate = createExecutionCapsuleMutationDispatchGate({
  enabled: true,
  capsuleService,
  async dynamicEvidenceProvider({
    capsule: observed,
    operationContract: observedContract,
    dispatchInput: observedInput,
  }) {
    assert.notEqual(observed, capsule);
    assert.equal(observed.capsuleHash, capsule.capsuleHash);
    assert.equal(observedContract.operationKey, operationContract.operationKey);
    assert.notEqual(observedInput, dispatchInput);
    assert.deepEqual(JSON.parse(JSON.stringify(observedInput)), dispatchInput);
    assert(Object.isFrozen(observedInput));
    return {
      currentContext,
      currentDependencies,
      items: dynamicItems(),
      now: VALIDATED_AT,
    };
  },
  async dispatchMutationOperation(envelope) {
    envelopes.push(envelope);
    return mutationResult;
  },
  async emitTelemetry(event) {
    events.push(event);
  },
});
const returned = await gate.dispatch({
  capsule,
  operationContract,
  governanceDecision,
  dispatchInput,
});
assert.equal(returned, mutationResult);
assert.equal(envelopes.length, 1);
assert(Object.isFrozen(envelopes[0]));
assert.equal(envelopes[0].operationContract.operationKind, "mutation");
assert.equal(envelopes[0].rollbackContract.required, true);
assert.equal(envelopes[0].dynamicEvidence.length, 7);
assert.equal(Object.hasOwn(envelopes[0], "capsule"), false);
assert.equal(events[0].validationStatus, "valid");
assert.equal(events[0].mutationAllowed, true);
assert.equal(events[0].capsuleGrantedAuthority, false);

let blockedDispatches = 0;
function blockedGate(overrides = {}) {
  return createExecutionCapsuleMutationDispatchGate({
    enabled: true,
    capsuleService,
    dynamicEvidenceProvider: async () => ({
      currentContext,
      currentDependencies,
      items: dynamicItems(overrides),
      now: VALIDATED_AT,
    }),
    dispatchMutationOperation: async () => {
      blockedDispatches += 1;
    },
    emitTelemetry: async () => {},
  });
}
await assert.rejects(
  () => blockedGate({ connection_status: { connectionRef: "connection-b" } }).dispatch({
    capsule,
    operationContract,
    governanceDecision,
    dispatchInput,
  }),
  (error) => error instanceof ExecutionCapsuleMutationDispatchError &&
    error.code === "execution_capsule_mutation_dispatch_context_re_resolution_required",
);
await assert.rejects(
  () => blockedGate({ expected_sha: { actualSha: "abcdef9999999" } }).dispatch({
    capsule,
    operationContract,
    governanceDecision,
    dispatchInput,
  }),
  (error) => error.code === "execution_capsule_mutation_dispatch_expected_sha_mismatch",
);
await assert.rejects(
  () => blockedGate().dispatch({
    capsule,
    operationContract: { ...operationContract, reversible: false },
    governanceDecision,
    dispatchInput,
  }),
  (error) => error.code === "execution_capsule_mutation_dispatch_requires_reversible_operation",
);
await assert.rejects(
  () => blockedGate().dispatch({
    capsule,
    operationContract: {
      ...operationContract,
      requiredDynamicEvidence: operationContract.requiredDynamicEvidence.filter(
        (key) => key !== "effective_authority",
      ),
    },
    governanceDecision,
    dispatchInput,
  }),
  (error) =>
    error.code === "execution_capsule_mutation_dispatch_dynamic_evidence_contract_incomplete" &&
    error.reasonCodes.includes(
      "execution_capsule_mutation_dispatch_effective_authority_required",
    ),
);
await assert.rejects(
  () => blockedGate().dispatch({
    capsule,
    operationContract,
    governanceDecision: {
      ...governanceDecision,
      status: "blocked",
      mutationAllowed: false,
    },
    dispatchInput,
  }),
  (error) => error.code === "execution_capsule_mutation_dispatch_governance_blocked",
);
await assert.rejects(
  () => blockedGate().dispatch({
    capsule,
    operationContract,
    governanceDecision,
    dispatchInput: { ...dispatchInput, repositoryRef: "repository-b" },
  }),
  (error) =>
    error.code === "execution_capsule_mutation_dispatch_context_re_resolution_required" &&
    error.reasonCodes.includes(
      "execution_capsule_mutation_dispatch_input_repositoryRef_mismatch",
    ),
);
await assert.rejects(
  () => blockedGate().dispatch({
    capsule,
    operationContract,
    governanceDecision,
    dispatchInput: { ...dispatchInput, expectedSha: "abcdef7654321" },
  }),
  (error) => error.code === "execution_capsule_mutation_dispatch_expected_sha_mismatch",
);
for (const unsafeInput of [
  { ...dispatchInput, authorization: "forbidden" },
  { ...dispatchInput, note: "Bearer must-never-reach-evidence" },
]) {
  await assert.rejects(
    () => blockedGate().dispatch({
      capsule,
      operationContract,
      governanceDecision,
      dispatchInput: unsafeInput,
    }),
    (error) => error.code === "execution_capsule_mutation_dispatch_input_unsafe",
  );
}
assert.equal(blockedDispatches, 0);
assert.equal(gate.rollback().enabled, false);

const passingMetrics = Object.freeze({
  medianResolutionImprovementPct: 45,
  candidateEnumerationReductionPct: 70,
  parityRatePct: 100,
  coveredOperationRatePct: 100,
  ambiguitySuppressionIncrease: 0,
  crossTenantAccessIncrease: 0,
  connectionSubstitutionIncrease: 0,
  staleAuthorityAcceptanceIncrease: 0,
  readPilotPassed: true,
  mutationPilotPassed: true,
  rollbackDrillPassed: true,
  exactHeadCiPassed: true,
  humanReviewPassed: true,
});
const passingMetricsDigest = independentMetricsDigest(passingMetrics);
assert.equal(
  computeExecutionCapsuleRuntimeMetricsDigest(passingMetrics),
  passingMetricsDigest,
  "the exported digest must match an independent canonical SHA-256 calculation",
);
const retirementPlan = Object.freeze({
  planRef: "ec-runtime-retirement-plan-a",
  replacementResolverKey: "execution-capsule-canonical-resolver",
  rollbackRef: "ec-runtime-retirement-rollback-a",
  metricsEvidenceRef: "ec-runtime-metrics-evidence-a",
  metricsEvidenceRevision: "ec-runtime-metrics-revision-a",
  metricsDigest: passingMetricsDigest,
  legacyResolverKeys: Object.freeze([
    "legacy-admin-context-resolver",
    "legacy-tenant-context-resolver",
  ]),
});
const retirementPlanDigest = independentRetirementPlanDigest(retirementPlan);
const evaluation = evaluateExecutionCapsuleRuntimeRollout({
  metrics: passingMetrics,
  retirementPlan,
});
assert.equal(evaluation.status, ExecutionCapsuleRuntimeRolloutStatus.READY);
assert.equal(evaluation.retirementReady, true);
assert.equal(evaluation.retirementApplied, false);
assert.equal(evaluation.metricsDigest, passingMetricsDigest);
assert.equal(evaluation.retirementPlanDigest, retirementPlanDigest);

const regressedMetrics = Object.freeze({
  ...passingMetrics,
  medianResolutionImprovementPct: 39,
  crossTenantAccessIncrease: 1,
});
assert.throws(
  () => evaluateExecutionCapsuleRuntimeRollout({
    metrics: regressedMetrics,
    retirementPlan,
  }),
  (error) => error.code === "execution_capsule_runtime_metrics_digest_mismatch",
  "metrics cannot change while reusing an approval-bound digest",
);
const regressedPlan = Object.freeze({
  ...retirementPlan,
  metricsDigest: independentMetricsDigest(regressedMetrics),
});
const blockedEvaluation = evaluateExecutionCapsuleRuntimeRollout({
  metrics: regressedMetrics,
  retirementPlan: regressedPlan,
});
assert.equal(blockedEvaluation.status, ExecutionCapsuleRuntimeRolloutStatus.BLOCKED);
assert(blockedEvaluation.failedGates.includes("median_resolution_improvement_below_40_pct"));
assert(blockedEvaluation.failedGates.includes("cross_tenant_access_regression"));
assert.throws(
  () => evaluateExecutionCapsuleRuntimeRollout({
    metrics: passingMetrics,
    retirementPlan: {
      ...retirementPlan,
      legacyResolverKeys: [retirementPlan.replacementResolverKey],
    },
  }),
  (error) => error.code === "execution_capsule_runtime_replacement_resolver_cannot_be_retired",
);

let retirementCalls = 0;
const rolloutGate = createExecutionCapsuleRuntimeRolloutGate({
  enabled: true,
  async retireLegacyResolvers({
    retirementPlan: plan,
    retirementPlanDigest: observedPlanDigest,
    approval,
  }) {
    retirementCalls += 1;
    assert(Object.isFrozen(plan));
    assert(Object.isFrozen(approval));
    assert.equal(observedPlanDigest, retirementPlanDigest);
    assert.equal(approval.planDigest, retirementPlanDigest);
    return {
      status: "retired",
      retiredResolverKeys: [...plan.legacyResolverKeys],
      replacementResolverKey: plan.replacementResolverKey,
      rollbackRef: plan.rollbackRef,
      rawProviderPayload: "must-not-be-projected",
    };
  },
  emitTelemetry: async () => {},
});
assert.equal((await rolloutGate.execute({
  metrics: passingMetrics,
  retirementPlan,
})).retirementApplied, false);
assert.equal(retirementCalls, 0);
await assert.rejects(
  () => rolloutGate.execute({
    metrics: passingMetrics,
    retirementPlan,
    applyRetirement: true,
    approval: {
      status: "approved",
      planRef: retirementPlan.planRef,
      planDigest: retirementPlanDigest,
      metricsEvidenceRef: retirementPlan.metricsEvidenceRef,
      metricsEvidenceRevision: retirementPlan.metricsEvidenceRevision,
      metricsDigest: `sha256-${"b".repeat(64)}`,
      decisionRef: "human-review-a",
      decisionRevision: "human-review-revision-a",
    },
  }),
  (error) => error.code === "execution_capsule_runtime_retirement_evidence_mismatch",
);
assert.equal(retirementCalls, 0);
const substitutedPlan = Object.freeze({
  ...retirementPlan,
  rollbackRef: "ec-runtime-retirement-rollback-b",
});
await assert.rejects(
  () => rolloutGate.execute({
    metrics: passingMetrics,
    retirementPlan: substitutedPlan,
    applyRetirement: true,
    approval: {
      status: "approved",
      planRef: substitutedPlan.planRef,
      planDigest: retirementPlanDigest,
      metricsEvidenceRef: substitutedPlan.metricsEvidenceRef,
      metricsEvidenceRevision: substitutedPlan.metricsEvidenceRevision,
      metricsDigest: substitutedPlan.metricsDigest,
      decisionRef: "human-review-a",
      decisionRevision: "human-review-revision-a",
    },
  }),
  (error) => error.code === "execution_capsule_runtime_retirement_evidence_mismatch",
  "an approval cannot be replayed against changed retirement plan contents",
);
assert.equal(retirementCalls, 0);
const retired = await rolloutGate.execute({
  metrics: passingMetrics,
  retirementPlan,
  applyRetirement: true,
  approval: {
    status: "approved",
    planRef: retirementPlan.planRef,
    planDigest: retirementPlanDigest,
    metricsEvidenceRef: retirementPlan.metricsEvidenceRef,
    metricsEvidenceRevision: retirementPlan.metricsEvidenceRevision,
    metricsDigest: retirementPlan.metricsDigest,
    decisionRef: "human-review-a",
    decisionRevision: "human-review-revision-a",
  },
});
assert.equal(retired.status, ExecutionCapsuleRuntimeRolloutStatus.RETIRED);
assert.equal(retired.retirementApplied, true);
assert.equal(retirementCalls, 1);
assert.deepEqual(retired.retirementResult.retiredResolverKeys, retirementPlan.legacyResolverKeys);
assert.equal(Object.hasOwn(retired.retirementResult, "rawProviderPayload"), false);
assert.equal(rolloutGate.rollback().enabled, false);

const directory = path.dirname(fileURLToPath(import.meta.url));
const mutationSource = await readFile(
  path.join(directory, "contextKernel", "integration", "executionCapsuleMutationDispatchGate.js"),
  "utf8",
);
const rolloutSource = await readFile(
  path.join(directory, "contextKernel", "integration", "executionCapsuleRuntimeRollout.js"),
  "utf8",
);
assert.doesNotMatch(mutationSource, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.doesNotMatch(rolloutSource, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.match(mutationSource, /dynamicRefreshComplete: true/);
assert.match(mutationSource, /context_re_resolution_required/);
assert.match(mutationSource, /SECRET_VALUE_PATTERNS/);
assert.match(mutationSource, /dynamic_evidence_contract_incomplete/);
assert.match(mutationSource, /assertDispatchInputBinding/);
assert.match(rolloutSource, /medianResolutionImprovementPct: 40/);
assert.match(rolloutSource, /candidateEnumerationReductionPct: 60/);
assert.match(rolloutSource, /metricsEvidenceRevision/);
assert.match(rolloutSource, /RETIREMENT_PLAN_DIGEST_SCHEMA/);
assert.match(rolloutSource, /replacement_resolver_cannot_be_retired/);
assert.match(rolloutSource, /execution_capsule_runtime_metrics_digest_mismatch/);

console.log("execution capsule mutation and rollout tests passed");
