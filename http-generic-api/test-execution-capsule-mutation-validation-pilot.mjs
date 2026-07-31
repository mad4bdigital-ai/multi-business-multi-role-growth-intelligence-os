import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsule } from "./contextKernel/domain/executionCapsule.js";
import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";
import {
  ExecutionCapsuleMutationValidationError,
  createExecutionCapsuleMutationValidationPilot,
} from "./contextKernel/integration/index.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";
const VALIDATED_AT = "2030-01-01T00:05:00.000Z";
const EXPIRES_AT = "2030-01-01T00:10:00.000Z";

function numericClock(start = Date.parse(VALIDATED_AT), increment = 11) {
  let current = start;
  return () => {
    const value = current;
    current += increment;
    return value;
  };
}

const capsule = createExecutionCapsule({
  contextHash: "context-hash-a",
  contextRevision: "context-revision-a",
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
  capabilityKey: "repository.write",
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
  principal: Object.freeze({
    principalType: capsule.principalType,
    principalRef: capsule.principalRef,
  }),
  effectiveSubject: Object.freeze({
    subjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
  }),
  tenantRef: capsule.tenantRef,
  workspaceRef: capsule.workspaceRef,
  brandRef: capsule.brandRef,
  resourceType: capsule.resourceType,
  resourceRef: capsule.resourceRef,
  connectionRef: capsule.connectionRef,
});
const currentDependencies = capsule.invalidationDependencies.map((entry) => ({ ...entry }));
const selectedTarget = Object.freeze({
  tenantRef: capsule.tenantRef,
  workspaceRef: capsule.workspaceRef,
  brandRef: capsule.brandRef,
  resourceType: capsule.resourceType,
  resourceRef: capsule.resourceRef,
  connectionRef: capsule.connectionRef,
});
const dynamicEvidenceKeys = Object.freeze([
  "approval_state",
  "capability_envelope",
  "connection_status",
  "owner_authority",
  "resource_version",
]);
const dynamicEvidenceRevisions = Object.freeze({
  approval_state: "approval-revision-a",
  capability_envelope: capsule.capabilityRevision,
  connection_status: capsule.credentialReadinessRevision,
  owner_authority: capsule.authorityRevision,
  resource_version: "resource-version-a",
});
const refreshedEvidence = Object.freeze(dynamicEvidenceKeys.map((key) => Object.freeze({
  key,
  revision: dynamicEvidenceRevisions[key],
  status: "current",
})));
const operationContract = Object.freeze({
  operationKey: "repository.item.update",
  operationKind: "mutation",
  riskClass: "mutation",
  mutationRequired: true,
  reversible: true,
  dynamicEvidenceKeys,
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
const approvalDecision = Object.freeze({
  approvalRef: "approval-a",
  approvalRevision: dynamicEvidenceRevisions.approval_state,
  operationKey: operationContract.operationKey,
  contextHash: capsule.contextHash,
  status: "approved",
  mutationAllowed: true,
});
const mutationDescriptor = Object.freeze({
  mutationRef: "mutation-a",
  expectedResourceVersion: dynamicEvidenceRevisions.resource_version,
  nextResourceVersion: "resource-version-b",
  reversible: true,
  rollbackMode: "required",
});
const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(VALIDATED_AT),
});

function completeDynamicEvidence(overrides = {}) {
  return {
    currentContext,
    currentDependencies,
    selectedTarget,
    refreshedEvidence,
    dynamicRefreshComplete: true,
    now: VALIDATED_AT,
    ...overrides,
  };
}

const legacyInput = Object.freeze({ mutation: "legacy" });
const legacyResult = Object.freeze({ status: "legacy-ok" });
const legacyCalls = [];
const disabledPilot = createExecutionCapsuleMutationValidationPilot({
  async executeReversibleMutation(input) {
    legacyCalls.push(input);
    return legacyResult;
  },
});
assert.equal(disabledPilot.enabled, false);
assert.equal(disabledPilot.mode, "legacy_mutation_execution");
assert.equal(await disabledPilot.execute({ legacyInput }), legacyResult);
assert.equal(legacyCalls[0], legacyInput, "disabled mode must preserve legacy input identity");

const state = { version: mutationDescriptor.expectedResourceVersion, value: "before" };
const envelopes = [];
const events = [];
const receipt = Object.freeze({
  mutationApplied: true,
  reversible: true,
  rollbackRef: "rollback-a",
  providerDispatchPerformed: false,
  databaseWritePerformed: false,
});
const pilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  async dynamicEvidenceProvider({
    capsule: observedCapsule,
    operationContract: observedOperation,
    governanceDecision: observedGovernance,
    approvalDecision: observedApproval,
    mutationDescriptor: observedMutation,
  }) {
    assert.notEqual(observedCapsule, capsule);
    assert.equal(observedCapsule.capsuleRef, capsule.capsuleRef);
    assert.equal(observedCapsule.capsuleHash, capsule.capsuleHash);
    assert(Object.isFrozen(observedCapsule));
    assert.deepEqual(observedOperation.dynamicEvidenceKeys, dynamicEvidenceKeys);
    assert.equal(observedGovernance.decisionRevision, governanceDecision.decisionRevision);
    assert.equal(observedApproval.approvalRevision, approvalDecision.approvalRevision);
    assert.equal(observedMutation.expectedResourceVersion, state.version);
    return completeDynamicEvidence();
  },
  async executeReversibleMutation(envelope) {
    envelopes.push(envelope);
    assert.equal(state.version, envelope.mutationDescriptor.expectedResourceVersion);
    state.version = envelope.mutationDescriptor.nextResourceVersion;
    state.value = "after";
    return receipt;
  },
  async emitTelemetry(event) {
    events.push(event);
  },
  clock: numericClock(),
});

const returnedReceipt = await pilot.execute({
  capsule,
  operationContract,
  governanceDecision,
  approvalDecision,
  mutationDescriptor,
});
assert.equal(returnedReceipt, receipt, "executor receipt identity must be preserved");
assert.equal(state.version, mutationDescriptor.nextResourceVersion);
assert.equal(state.value, "after");
assert.equal(envelopes.length, 1);
const envelope = envelopes[0];
assert(Object.isFrozen(envelope));
assert(Object.isFrozen(envelope.operationContract));
assert(Object.isFrozen(envelope.governanceDecision));
assert(Object.isFrozen(envelope.approvalDecision));
assert(Object.isFrozen(envelope.executionContext));
assert(Object.isFrozen(envelope.mutationDescriptor));
assert(Object.isFrozen(envelope.dynamicEvidence));
assert(envelope.dynamicEvidence.every(Object.isFrozen));
assert.equal(Object.hasOwn(envelope, "capsule"), false);
assert.equal(Object.hasOwn(envelope, "currentContext"), false);
assert.equal(envelope.executionContext.tenantRef, capsule.tenantRef);
assert.equal(envelope.executionContext.connectionRef, capsule.connectionRef);
assert.deepEqual(
  envelope.dynamicEvidence.map((entry) => entry.key),
  dynamicEvidenceKeys,
);
assert.deepEqual(events[0], {
  eventType: "execution_capsule_mutation_validation",
  operationKey: operationContract.operationKey,
  validationStatus: "valid",
  governanceStatus: "allowed",
  approvalStatus: "approved",
  dynamicRefreshComplete: true,
  exactTargetRetained: true,
  executorInvoked: true,
  mutationApplied: true,
  reversible: true,
  providerDispatchPerformed: false,
  databaseWritePerformed: false,
  capsuleGrantedAuthority: false,
  durationMs: 11,
  reasonCodes: [],
  secretsIncluded: false,
});
assert(Object.isFrozen(events[0]));

function applyControlledRollback(value) {
  assert.equal(value.rollbackRef, "rollback-a");
  state.version = mutationDescriptor.expectedResourceVersion;
  state.value = "before";
}
applyControlledRollback(returnedReceipt);
assert.equal(state.version, mutationDescriptor.expectedResourceVersion);
assert.equal(state.value, "before");

let blockedExecutorCalls = 0;
const refreshEvents = [];
const incompleteRefreshPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({
    dynamicRefreshComplete: false,
  }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  async emitTelemetry(event) {
    refreshEvents.push(event);
  },
});
await assert.rejects(
  () => incompleteRefreshPilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error instanceof ExecutionCapsuleMutationValidationError &&
    error.code === "execution_capsule_mutation_dynamic_refresh_required",
);
assert.equal(blockedExecutorCalls, 0);
assert.equal(refreshEvents[0].validationStatus, "dynamic_refresh_required");
assert.equal(refreshEvents[0].dynamicRefreshComplete, false);

const substitutionEvents = [];
const substitutionPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({
    selectedTarget: { ...selectedTarget, connectionRef: "connection-b" },
  }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  async emitTelemetry(event) {
    substitutionEvents.push(event);
  },
});
await assert.rejects(
  () => substitutionPilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "context_re_resolution_required" &&
    error.reasonCodes.includes("execution_capsule_mutation_target_substitution_blocked"),
);
assert.equal(blockedExecutorCalls, 0);
assert.equal(substitutionEvents[0].exactTargetRetained, false);

const bindingMismatchPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({
    refreshedEvidence: refreshedEvidence.map((entry) =>
      entry.key === "resource_version"
        ? { ...entry, revision: "resource-version-stale" }
        : entry
    ),
  }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => bindingMismatchPilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_dynamic_evidence_binding_mismatch" &&
    error.reasonCodes.includes("execution_capsule_mutation_resource_version_revision_mismatch"),
);
assert.equal(blockedExecutorCalls, 0);

const incompleteEvidencePilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({
    refreshedEvidence: refreshedEvidence.slice(1),
  }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => incompleteEvidencePilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_dynamic_evidence_incomplete",
);
assert.equal(blockedExecutorCalls, 0);

let evidenceCallsAfterGovernanceDenial = 0;
const deniedPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => {
    evidenceCallsAfterGovernanceDenial += 1;
    return completeDynamicEvidence();
  },
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => deniedPilot.execute({
    capsule,
    operationContract,
    governanceDecision: {
      ...governanceDecision,
      status: "blocked",
      dispatchAllowed: false,
      mutationAllowed: false,
      reasonCodes: ["policy_denied"],
    },
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_governance_blocked" &&
    error.reasonCodes.includes("policy_denied"),
);
assert.equal(evidenceCallsAfterGovernanceDenial, 0);
assert.equal(blockedExecutorCalls, 0);

await assert.rejects(
  () => deniedPilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision: {
      ...approvalDecision,
      status: "revoked",
      mutationAllowed: false,
      reasonCodes: ["approval_revoked"],
    },
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_approval_blocked" &&
    error.reasonCodes.includes("approval_revoked"),
);
assert.equal(evidenceCallsAfterGovernanceDenial, 0);
assert.equal(blockedExecutorCalls, 0);

await assert.rejects(
  () => deniedPilot.execute({
    capsule,
    operationContract: {
      ...operationContract,
      operationKind: "read",
      mutationRequired: false,
    },
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_contract_required",
);
assert.equal(evidenceCallsAfterGovernanceDenial, 0);

const failureEvents = [];
const executorFailurePilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  async executeReversibleMutation() {
    const error = new Error("mutation backend body must never enter telemetry");
    error.code = "mutation_executor_failed";
    throw error;
  },
  async emitTelemetry(event) {
    failureEvents.push(event);
  },
});
await assert.rejects(
  () => executorFailurePilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  /mutation backend body must never enter telemetry/u,
);
assert.equal(failureEvents[0].executorInvoked, true);
assert.equal(failureEvents[0].mutationApplied, false);
assert.equal(failureEvents[0].governanceStatus, "allowed");
assert.equal(failureEvents[0].approvalStatus, "approved");
assert.deepEqual(failureEvents[0].reasonCodes, ["mutation_executor_failed"]);
assert.equal(JSON.stringify(failureEvents[0]).includes("backend body"), false);

const invalidReceiptPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  executeReversibleMutation: async () => ({
    ...receipt,
    providerPayload: "must-not-cross-boundary",
  }),
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => invalidReceiptPilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_receipt_unbounded",
);

const telemetryOutagePilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  executeReversibleMutation: async () => receipt,
  async emitTelemetry() {
    throw new Error("telemetry unavailable");
  },
});
assert.equal(
  await telemetryOutagePilot.execute({
    capsule,
    operationContract,
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  receipt,
);

const rolledBack = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  executeReversibleMutation: async (input) => input === legacyInput ? receipt : legacyResult,
  emitTelemetry: async () => {},
}).rollback();
assert.equal(rolledBack.enabled, false);
assert.equal(await rolledBack.execute({ legacyInput }), receipt);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(
    currentDirectory,
    "contextKernel",
    "integration",
    "executionCapsuleMutationValidationPilot.js",
  ),
  "utf8",
);
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/iu);
assert.match(source, /operationKind !== "mutation"/u);
assert.match(source, /dynamic_evidence_binding_mismatch/u);
assert.match(source, /context_re_resolution_required/u);
assert.match(source, /capsuleGrantedAuthority: false/u);
assert.match(source, /providerDispatchPerformed: false/u);
assert.match(source, /databaseWritePerformed: false/u);

console.log("execution capsule mutation validation pilot tests passed");
