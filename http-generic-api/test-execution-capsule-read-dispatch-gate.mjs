import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsule } from "./contextKernel/domain/executionCapsule.js";
import {
  ExecutionCapsuleReadDispatchError,
  createExecutionCapsuleReadDispatchGate,
} from "./contextKernel/integration/index.js";
import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";
const VALIDATED_AT = "2030-01-01T00:05:00.000Z";
const EXPIRES_AT = "2030-01-01T00:10:00.000Z";

function numericClock(start = Date.parse(VALIDATED_AT), increment = 7) {
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
  capabilityKey: "repository.read",
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
  effectiveSubject: {
    subjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
  },
  tenantRef: capsule.tenantRef,
  workspaceRef: capsule.workspaceRef,
  brandRef: capsule.brandRef,
  resourceType: capsule.resourceType,
  resourceRef: capsule.resourceRef,
  connectionRef: capsule.connectionRef,
});
const currentDependencies = capsule.invalidationDependencies.map((entry) => ({ ...entry }));
const operationContract = Object.freeze({
  operationKey: "repository.item.read",
  operationKind: "read",
  riskClass: "read",
  mutationRequired: false,
});
const governanceDecision = Object.freeze({
  decisionRef: "governance-decision-a",
  decisionRevision: "governance-revision-a",
  operationKey: operationContract.operationKey,
  contextHash: capsule.contextHash,
  status: "allowed",
  dispatchAllowed: true,
  mutationAllowed: false,
});
const dispatchInput = Object.freeze({
  resourceRef: "repository-a",
  query: Object.freeze({ path: "README.md", includeMetadata: true }),
});
const unsafeDispatchInput = Object.freeze({
  ...dispatchInput,
  authorization: "Bearer must-never-appear-in-evidence",
});
const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(VALIDATED_AT),
});

const legacyResult = Object.freeze({ status: "ok", payload: { title: "README" } });
const legacyInputs = [];
const disabledGate = createExecutionCapsuleReadDispatchGate({
  async dispatchReadOperation(input) {
    legacyInputs.push(input);
    return legacyResult;
  },
});
assert.equal(disabledGate.enabled, false);
assert.equal(disabledGate.mode, "legacy_read_dispatch");
assert.equal(await disabledGate.dispatch({ dispatchInput }), legacyResult);
assert.equal(legacyInputs[0], dispatchInput, "disabled mode must preserve the legacy dispatcher input");

const dispatchEnvelopes = [];
const events = [];
const gate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  async currentEvidenceProvider({ capsule: observed, operationContract: observedContract, dispatchInput: observedInput }) {
    assert.notEqual(observed, capsule);
    assert.equal(observed.capsuleRef, capsule.capsuleRef);
    assert.equal(observed.capsuleHash, capsule.capsuleHash);
    assert(Object.isFrozen(observed));
    assert.equal(observedContract.operationKey, operationContract.operationKey);
    assert.notEqual(observedInput, dispatchInput, "evidence provider must receive a safe projection, not raw input");
    assert.deepEqual(JSON.parse(JSON.stringify(observedInput)), dispatchInput);
    assert(Object.isFrozen(observedInput));
    assert(Object.isFrozen(observedInput.query));
    return {
      currentContext,
      currentDependencies,
      now: VALIDATED_AT,
    };
  },
  async dispatchReadOperation(envelope) {
    dispatchEnvelopes.push(envelope);
    return legacyResult;
  },
  async emitTelemetry(event) {
    events.push(event);
  },
  clock: numericClock(),
});

const returned = await gate.dispatch({
  capsule,
  operationContract,
  governanceDecision,
  dispatchInput,
});
assert.equal(returned, legacyResult, "enabled gate must preserve the exact dispatcher result object");
assert.equal(dispatchEnvelopes.length, 1);
const envelope = dispatchEnvelopes[0];
assert(Object.isFrozen(envelope));
assert.notEqual(envelope.dispatchInput, dispatchInput);
assert.deepEqual(JSON.parse(JSON.stringify(envelope.dispatchInput)), dispatchInput);
assert(Object.isFrozen(envelope.dispatchInput));
assert(Object.isFrozen(envelope.dispatchInput.query));
assert.equal(envelope.operationContract.operationKind, "read");
assert.equal(envelope.operationContract.mutationRequired, false);
assert.equal(envelope.governanceDecision.status, "allowed");
assert.equal(envelope.governanceDecision.mutationAllowed, false);
assert.equal(envelope.executionContext.capsuleRef, capsule.capsuleRef);
assert.equal(envelope.executionContext.contextHash, capsule.contextHash);
assert.equal(envelope.executionContext.connectionRef, capsule.connectionRef);
assert.equal(Object.hasOwn(envelope, "capsule"), false, "raw capsule must not be passed to the dispatcher");
assert.equal(JSON.stringify(envelope).includes("must-never-appear"), false);
assert.deepEqual(events[0], {
  eventType: "execution_capsule_read_dispatch",
  mode: "read_only",
  operationKey: operationContract.operationKey,
  validationStatus: "valid",
  governanceStatus: "allowed",
  dispatcherInvoked: true,
  dispatchSucceeded: true,
  mutationAllowed: false,
  capsuleGrantedAuthority: false,
  durationMs: 7,
  reasonCodes: [],
  secretsIncluded: false,
});
assert(Object.isFrozen(events[0]));
assert.equal(JSON.stringify(events[0]).includes("must-never-appear"), false);

let unsafeEvidenceCalls = 0;
let unsafeDispatchCalls = 0;
const unsafeEvents = [];
const unsafeGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => {
    unsafeEvidenceCalls += 1;
    return { currentContext, currentDependencies, now: VALIDATED_AT };
  },
  async dispatchReadOperation() {
    unsafeDispatchCalls += 1;
  },
  async emitTelemetry(event) {
    unsafeEvents.push(event);
  },
});
await assert.rejects(
  () => unsafeGate.dispatch({
    capsule,
    operationContract,
    governanceDecision,
    dispatchInput: unsafeDispatchInput,
  }),
  (error) => error instanceof ExecutionCapsuleReadDispatchError &&
    error.code === "execution_capsule_read_dispatch_input_unsafe" &&
    error.reasonCodes.includes("execution_capsule_read_dispatch_input_authority_field"),
);
assert.equal(unsafeEvidenceCalls, 0, "unsafe input must fail before current-evidence resolution");
assert.equal(unsafeDispatchCalls, 0, "unsafe input must fail before dispatch");
assert.equal(unsafeEvents[0].dispatcherInvoked, false);
assert.deepEqual(unsafeEvents[0].reasonCodes, ["execution_capsule_read_dispatch_input_authority_field"]);
assert.equal(JSON.stringify(unsafeEvents[0]).includes("must-never-appear"), false);

let blockedDispatchCalls = 0;
const blockedEvents = [];
const blockedGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => ({
    currentContext,
    currentDependencies,
    now: VALIDATED_AT,
  }),
  async dispatchReadOperation() {
    blockedDispatchCalls += 1;
  },
  async emitTelemetry(event) {
    blockedEvents.push(event);
  },
});
await assert.rejects(
  () => blockedGate.dispatch({
    capsule,
    operationContract,
    governanceDecision: {
      ...governanceDecision,
      status: "blocked",
      dispatchAllowed: false,
      reasonCodes: ["policy_denied"],
    },
    dispatchInput,
  }),
  (error) => error instanceof ExecutionCapsuleReadDispatchError &&
    error.code === "execution_capsule_read_dispatch_governance_blocked",
);
assert.equal(blockedDispatchCalls, 0);
assert.equal(blockedEvents[0].dispatcherInvoked, false);
assert.deepEqual(blockedEvents[0].reasonCodes, ["policy_denied"]);

await assert.rejects(
  () => blockedGate.dispatch({
    capsule,
    operationContract: {
      operationKey: "repository.item.write",
      operationKind: "mutation",
      riskClass: "mutation",
      mutationRequired: true,
    },
    governanceDecision,
    dispatchInput,
  }),
  (error) => error.code === "execution_capsule_read_dispatch_requires_read_operation",
);
assert.equal(blockedDispatchCalls, 0, "mutation operation must fail before dispatch");

const mismatchEvents = [];
const mismatchGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => ({
    currentContext: { ...currentContext, resourceRef: "repository-b" },
    currentDependencies,
    now: VALIDATED_AT,
  }),
  async dispatchReadOperation() {
    blockedDispatchCalls += 1;
  },
  async emitTelemetry(event) {
    mismatchEvents.push(event);
  },
});
await assert.rejects(
  () => mismatchGate.dispatch({ capsule, operationContract, governanceDecision, dispatchInput }),
  (error) => error.code === "execution_capsule_read_dispatch_context_mismatch",
);
assert.equal(mismatchEvents[0].validationStatus, "context_mismatch");
assert.equal(mismatchEvents[0].dispatcherInvoked, false);

const dispatcherFailureEvents = [];
const dispatcherFailureGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => ({
    currentContext,
    currentDependencies,
    now: VALIDATED_AT,
  }),
  async dispatchReadOperation() {
    const error = new Error("provider body must not appear in telemetry");
    error.code = "read_dispatch_failed";
    throw error;
  },
  async emitTelemetry(event) {
    dispatcherFailureEvents.push(event);
  },
});
await assert.rejects(
  () => dispatcherFailureGate.dispatch({ capsule, operationContract, governanceDecision, dispatchInput }),
  /provider body must not appear/u,
);
assert.equal(dispatcherFailureEvents[0].dispatcherInvoked, true);
assert.equal(dispatcherFailureEvents[0].dispatchSucceeded, false);
assert.deepEqual(dispatcherFailureEvents[0].reasonCodes, ["read_dispatch_failed"]);
assert.equal(JSON.stringify(dispatcherFailureEvents[0]).includes("provider body"), false);

const telemetryOutageGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => ({
    currentContext,
    currentDependencies,
    now: VALIDATED_AT,
  }),
  dispatchReadOperation: async () => legacyResult,
  async emitTelemetry() {
    throw new Error("telemetry unavailable");
  },
});
assert.equal(
  await telemetryOutageGate.dispatch({ capsule, operationContract, governanceDecision, dispatchInput }),
  legacyResult,
  "telemetry outage must not change a successful dispatch result",
);

const rolledBack = gate.rollback();
assert.equal(rolledBack.enabled, false);
const rollbackResult = Object.freeze({ status: "rollback-ok" });
const rollbackInput = Object.freeze({ read: true });
const rollbackGate = createExecutionCapsuleReadDispatchGate({
  enabled: true,
  capsuleService,
  currentEvidenceProvider: async () => ({ currentContext, currentDependencies, now: VALIDATED_AT }),
  dispatchReadOperation: async (input) => input === rollbackInput ? rollbackResult : legacyResult,
  emitTelemetry: async () => {},
}).rollback();
assert.equal(await rollbackGate.dispatch({ dispatchInput: rollbackInput }), rollbackResult);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(currentDirectory, "contextKernel", "integration", "executionCapsuleReadDispatchGate.js"),
  "utf8",
);
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.match(source, /enabled !== true/);
assert.match(source, /operationKind !== "read"/);
assert.match(source, /mutationAllowed !== false/);
assert.match(source, /capsuleGrantedAuthority: false/);
assert.match(source, /dispatcherInvoked/);
assert.match(source, /projectSafeDispatchInput/);
assert.match(source, /FORBIDDEN_DISPATCH_FIELDS/);

console.log("execution capsule read dispatch gate tests passed");
