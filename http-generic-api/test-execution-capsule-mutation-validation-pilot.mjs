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
const refreshedEvidence = Object.freeze(dynamicEvidenceKeys.map((key) => Object.freeze({
  key,
  revision: `${key}-revision-a`,
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
  approvalRevision: "approval-revision-a",
  operationKey: operationContract.operationKey,
  contextHash: capsule.contextHash,
  status: "approved",
  mutationAllowed: true,
});
const mutationDescriptor = Object.freeze({
  mutationRef: "mutation-a",
  expectedResourceVersion: "version-1",
  nextResourceVersion: "version-2",
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
const disabled = createExecutionCapsuleMutationValidationPilot({
  async executeReversibleMutation(input) {
    legacyCalls.push(input);
    return legacyResult;
  },
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.mode, "legacy_mutation_execution");
assert.equal(await disabled.execute({ legacyInput }), legacyResult);
assert.equal(legacyCalls[0], legacyInput, "disabled mode must preserve legacy call identity");

const state = { version: "version-1", value: "before" };
const executionEnvelopes = [];
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
    mutationDescriptor: observedMutation,
  }) {
    assert.notEqual(observedCapsule, capsule);
    assert.equal(observedCapsule.capsuleRef, capsule.capsuleRef);
    assert.equal(observedCapsule.capsuleHash, capsule.capsuleHash);
    assert(Object.isFrozen(observedCapsule));
    assert.deepEqual(observedOperation.dynamicEvidenceKeys, [...dynamicEvidenceKeys].sort());
    assert.equal(observedMutation.expectedResourceVersion, state.version);
    assert(Object.isFrozen(observedMutation));
    return completeDynamicEvidence();
  },
  async executeReversibleMutation(envelope) {
    executionEnvelopes.push(envelope);
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
assert.equal(returnedReceipt, receipt, "pilot must preserve the exact executor receipt object");
assert.equal(state.version, "version-2");
assert.equal(state.value, "after");
assert.equal(executionEnvelopes.length, 1);
const envelope = executionEnvelopes[0];
assert(Object.isFrozen(envelope));
assert(Object.isFrozen(envelope.operationContract));
assert(Object.isFrozen(envelope.governanceDecision));
assert(Object.isFrozen(envelope.approvalDecision));
assert(Object.isFrozen(envelope.executionContext));
assert(Object.isFrozen(envelope.mutationDescriptor));
assert(Object.isFrozen(envelope.dynamicEvidence));
assert(envelope.dynamicEvidence.every(Object.isFrozen));
assert.equal(Object.hasOwn(envelope, "capsule"), false);
assert.equal(envelope.executionContext.connectionRef, capsule.connectionRef);
assert.equal(envelope.operationContract.operationKind, "mutation");
assert.equal(envelope.operationContract.reversible, true);
assert.equal(envelope.governanceDecision.mutationAllowed, true);
assert.equal(envelope.approvalDecision.status, "approved");
assert.deepEqual(envelope.dynamicEvidence.map((entry) => entry.key), [...dynamicEvidenceKeys].sort());
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

function applyRollback(value) {
  assert.equal(value.rollbackRef, "rollback-a");
  state.version = mutationDescriptor.expectedResourceVersion;
  state.value = "before";
}
applyRollback(returnedReceipt);
assert.equal(state.version, "version-1", "reversible pilot mutation must restore the prior version");
assert.equal(state.value, "before");

let blockedExecutorCalls = 0;
const incompleteRefreshEvents = [];
const incompleteRefreshPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({ dynamicRefreshComplete: false }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  async emitTelemetry(event) {
    incompleteRefreshEvents.push(event);
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
assert.equal(incompleteRefreshEvents[0].validationStatus, "dynamic_refresh_required");
assert.equal(incompleteRefreshEvents[0].executorInvoked, false);

const substitutedTargetEvents = [];
const substitutedTargetPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence({
    selectedTarget: { ...selectedTarget, connectionRef: "connection-b" },
  }),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  async emitTelemetry(event) {
    substitutedTargetEvents.push(event);
  },
});
await assert.rejects(
  () => substitutedTargetPilot.execute({
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
assert.equal(substitutedTargetEvents[0].exactTargetRetained, false);
assert.equal(substitutedTargetEvents[0].executorInvoked, false);

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

const governanceBlockedPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => governanceBlockedPilot.execute({
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
assert.equal(blockedExecutorCalls, 0);

await assert.rejects(
  () => governanceBlockedPilot.execute({
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
assert.equal(blockedExecutorCalls, 0);

let evidenceCallsForReadContract = 0;
const mutationOnlyPilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => {
    evidenceCallsForReadContract += 1;
    return completeDynamicEvidence();
  },
  async executeReversibleMutation() {
    blockedExecutorCalls += 1;
  },
  emitTelemetry: async () => {},
});
await assert.rejects(
  () => mutationOnlyPilot.execute({
    capsule,
    operationContract: {
      operationKey: "repository.item.read",
      operationKind: "read",
      mutationRequired: false,
      reversible: true,
      dynamicEvidenceKeys,
    },
    governanceDecision,
    approvalDecision,
    mutationDescriptor,
  }),
  (error) => error.code === "execution_capsule_mutation_contract_required",
);
assert.equal(evidenceCallsForReadContract, 0, "non-mutation contracts must fail before refresh");
assert.equal(blockedExecutorCalls, 0);

const executorFailureEvents = [];
const executorFailurePilot = createExecutionCapsuleMutationValidationPilot({
  enabled: true,
  capsuleService,
  dynamicEvidenceProvider: async () => completeDynamicEvidence(),
  async executeReversibleMutation() {
    const error = new Error("mutation backend body must not appear in telemetry");
    error.code = "mutation_executor_failed";
    throw error;
  },
  async emitTelemetry(event) {
    executorFailureEvents.push(event);
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
  /mutation backend body must not appear/u,
);
assert.equal(executorFailureEvents[0].executorInvoked, true);
assert.equal(executorFailureEvents[0].mutationApplied, false);
assert.deepEqual(executorFailureEvents[0].reasonCodes, ["mutation_executor_failed"]);
assert.equal(JSON.stringify(executorFailureEvents[0]).includes("backend body"), false);

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
  "telemetry outage must not alter the successful mutation receipt",
);

const rolledBack = pilot.rollback();
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
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.match(source, /operationKind !== "mutation"/);
assert.match(source, /dynamicRefreshComplete/);
assert.match(source, /context_re_resolution_required/);
assert.match(source, /capsuleGrantedAuthority: false/);
assert.match(source, /providerDispatchPerformed: false/);
assert.match(source, /databaseWritePerformed: false/);

console.log("execution capsule mutation validation pilot tests passed");
