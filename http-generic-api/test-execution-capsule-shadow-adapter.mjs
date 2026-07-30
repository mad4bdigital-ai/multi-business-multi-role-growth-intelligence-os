import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";
import {
  createExecutionCapsuleShadowResolutionService,
  createResourceApiContextShadowMiddleware,
} from "./contextKernel/integration/index.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";

function createResolution({
  status = "resolved",
  tenantRef = "tenant-a",
  workspaceRef = "workspace-a",
  brandRef = "brand-a",
  resourceType = "repository",
  resourceRef = "repository-a",
  connectionRef = "connection-a",
  capabilityKey = "repository.read",
} = {}) {
  const selectedCandidate = Object.freeze({
    candidateType: "connection",
    stableRef: connectionRef,
    tenantRef,
    workspaceRef,
    brandRef,
    resourceType,
    resourceRef,
    connectionRef,
  });
  const capabilityReadiness = Object.freeze({
    capabilityKey,
    dispatchAllowed: true,
    applyAllowed: false,
  });
  return {
    status,
    reasonCodes: status === "resolved" ? [] : ["context_blocked"],
    selectedCandidate: status === "resolved" ? selectedCandidate : null,
    candidates: status === "resolved" ? [selectedCandidate] : [],
    authorityScope: { tenantRef, role: "member" },
    capabilityReadiness,
    context: status === "resolved" ? {
      contextHash: "context-hash-a",
      contextRevision: "context-revision-a",
      principal: {
        principalType: "tenant_user",
        principalRef: "principal-a",
      },
      effectiveSubject: {
        subjectRef: "subject-a",
        tenantRef,
        workspaceRef,
      },
      tenantRef,
      workspaceRef,
      brandRef,
      resourceType,
      resourceRef,
      connectionRef,
      selectedCandidate,
      capability: capabilityReadiness,
      credentials: { accessToken: "must-never-appear" },
      authorization: "Bearer must-never-appear",
    } : null,
    credentials: { password: "must-never-appear" },
  };
}

function capsuleEvidence() {
  return {
    authorityPathRef: "authority-path-a",
    authorityRevision: "authority-revision-a",
    capabilityRevision: "capability-revision-a",
    registryRevision: "registry-revision-a",
    credentialReadinessRevision: "credential-readiness-revision-a",
    invalidationDependencies: [
      {
        domain: "resourceVersion",
        ref: "repository:repository-a",
        revision: "resource-revision-a",
        refreshClass: "dynamic",
      },
    ],
  };
}

function createNumericClock(start = 1000, increment = 7) {
  let current = start;
  return () => {
    const value = current;
    current += increment;
    return value;
  };
}

const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(ISSUED_AT),
  defaultTtlMs: 10 * 60 * 1000,
});

const resolution = createResolution();
const successEvents = [];
let evidenceCalls = 0;
const successWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService,
  async capsuleEvidenceProvider({ resolution: observed, resolutionInput }) {
    evidenceCalls += 1;
    assert.equal(observed, resolution);
    assert.deepEqual(resolutionInput, { operationIntent: "resource_item_read" });
    return capsuleEvidence();
  },
  async emitTelemetry(event) { successEvents.push(event); },
  clock: createNumericClock(),
});

const returned = await successWrapper.resolve({ operationIntent: "resource_item_read" });
assert.equal(returned, resolution, "shadow adapter must preserve the exact legacy resolution object");
assert.equal(evidenceCalls, 1);
assert.equal(successEvents.length, 1);
assert.deepEqual(successEvents[0], {
  eventType: "execution_capsule_shadow",
  shadowMode: true,
  durationMs: 7,
  resolutionStatus: "resolved",
  candidateCount: 1,
  selectedCandidatePresent: true,
  providerDispatchPerformed: false,
  legacyResolutionModified: false,
  executionAllowed: false,
  automaticWritePerformed: false,
  secretsIncluded: false,
  capsuleAttempted: true,
  capsuleCreated: true,
  capsuleOutcome: "matched",
  capsuleStatus: "resolved",
  capsuleTargetMatched: true,
  reasonCodes: [],
});
assert(Object.isFrozen(successEvents[0]));
assert.equal(JSON.stringify(successEvents[0]).includes("must-never-appear"), false);
assert.throws(() => { successEvents[0].capsuleOutcome = "changed"; }, TypeError);

let unresolvedEvidenceCalls = 0;
const blockedResolution = createResolution({ status: "blocked" });
const unresolvedEvents = [];
const unresolvedWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return blockedResolution; } },
  capsuleService,
  async capsuleEvidenceProvider() {
    unresolvedEvidenceCalls += 1;
    return capsuleEvidence();
  },
  async emitTelemetry(event) { unresolvedEvents.push(event); },
  clock: createNumericClock(2000, 3),
});
assert.equal(await unresolvedWrapper.resolve({}), blockedResolution);
assert.equal(unresolvedEvidenceCalls, 0, "unresolved contexts must not request revision evidence");
assert.equal(unresolvedEvents[0].capsuleAttempted, false);
assert.equal(unresolvedEvents[0].capsuleCreated, false);
assert.equal(unresolvedEvents[0].capsuleOutcome, "not_attempted");
assert.deepEqual(unresolvedEvents[0].reasonCodes, ["context_not_resolved"]);

const unboundedStatusResolution = createResolution({ status: `blocked-${"x".repeat(100)}` });
const unboundedStatusEvents = [];
const unboundedStatusWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return unboundedStatusResolution; } },
  capsuleService,
  capsuleEvidenceProvider: async () => capsuleEvidence(),
  async emitTelemetry(event) { unboundedStatusEvents.push(event); },
});
assert.equal(await unboundedStatusWrapper.resolve({}), unboundedStatusResolution);
assert.equal(unboundedStatusEvents[0].resolutionStatus, null);
assert.deepEqual(unboundedStatusEvents[0].reasonCodes, ["context_not_resolved"]);

const evidenceFailureEvents = [];
const evidenceFailureWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService,
  async capsuleEvidenceProvider() {
    const error = new Error("credential details must not leak");
    error.code = "revision_evidence_unavailable";
    throw error;
  },
  async emitTelemetry(event) { evidenceFailureEvents.push(event); },
});
assert.equal(await evidenceFailureWrapper.resolve({}), resolution);
assert.equal(evidenceFailureEvents[0].capsuleOutcome, "build_failed");
assert.deepEqual(evidenceFailureEvents[0].reasonCodes, ["revision_evidence_unavailable"]);
assert.equal(JSON.stringify(evidenceFailureEvents[0]).includes("credential details"), false);

const invariantFailureEvents = [];
const invariantFailureWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService: {
    resolve() {
      return {
        status: "resolved",
        executionAllowed: true,
        automaticWritePerformed: false,
        secretsIncluded: false,
        capsule: {
          executionAllowed: false,
          secretsIncluded: false,
        },
      };
    },
  },
  capsuleEvidenceProvider: async () => capsuleEvidence(),
  async emitTelemetry(event) { invariantFailureEvents.push(event); },
});
assert.equal(await invariantFailureWrapper.resolve({}), resolution);
assert.equal(invariantFailureEvents[0].capsuleCreated, false);
assert.deepEqual(
  invariantFailureEvents[0].reasonCodes,
  ["execution_capsule_shadow_security_invariant_failed"],
);

const mismatchEvents = [];
const mismatchWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService: {
    resolve() {
      return {
        status: "resolved",
        executionAllowed: false,
        automaticWritePerformed: false,
        secretsIncluded: false,
        capsule: {
          tenantRef: "tenant-a",
          workspaceRef: "workspace-a",
          brandRef: "brand-a",
          resourceType: "repository",
          resourceRef: "repository-other",
          connectionRef: "connection-a",
          executionAllowed: false,
          secretsIncluded: false,
        },
      };
    },
  },
  capsuleEvidenceProvider: async () => capsuleEvidence(),
  async emitTelemetry(event) { mismatchEvents.push(event); },
});
assert.equal(await mismatchWrapper.resolve({}), resolution);
assert.equal(mismatchEvents[0].capsuleCreated, true);
assert.equal(mismatchEvents[0].capsuleOutcome, "mismatched");
assert.equal(mismatchEvents[0].capsuleTargetMatched, false);
assert.deepEqual(
  mismatchEvents[0].reasonCodes,
  ["execution_capsule_shadow_target_mismatch"],
);

const telemetryOutageWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService,
  capsuleEvidenceProvider: async () => capsuleEvidence(),
  async emitTelemetry() { throw new Error("telemetry outage"); },
});
assert.equal(
  await telemetryOutageWrapper.resolve({}),
  resolution,
  "telemetry failure must not affect the legacy resolution",
);

const clockFailureEvents = [];
const clockFailureWrapper = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return resolution; } },
  capsuleService,
  capsuleEvidenceProvider: async () => capsuleEvidence(),
  async emitTelemetry(event) { clockFailureEvents.push(event); },
  clock() { throw new Error("shadow clock unavailable"); },
});
assert.equal(
  await clockFailureWrapper.resolve({}),
  resolution,
  "shadow clock failure must not affect the legacy resolution",
);
assert.equal(clockFailureEvents[0].durationMs, 0);
assert.equal(clockFailureEvents[0].capsuleOutcome, "matched");

class FakeResponse extends EventEmitter {
  constructor(statusCode = 200) {
    super();
    this.statusCode = statusCode;
  }
}

async function runScheduled(queue) {
  while (queue.length > 0) await queue.shift()();
}

const brandResolution = createResolution({
  resourceType: "brand",
  resourceRef: "brand-a",
  connectionRef: "connection-brand-a",
  capabilityKey: "brand.read",
});
const capsuleEvents = [];
const resourceEvents = [];
const scheduled = [];
const composedResolutionService = createExecutionCapsuleShadowResolutionService({
  resolutionService: { async resolve() { return brandResolution; } },
  capsuleService,
  capsuleEvidenceProvider: async () => ({
    ...capsuleEvidence(),
    capabilityRevision: "brand-read-capability-revision-a",
    invalidationDependencies: [],
  }),
  async emitTelemetry(event) { capsuleEvents.push(event); },
  clock: createNumericClock(3000, 4),
});
const middleware = createResourceApiContextShadowMiddleware({
  enabled: true,
  resolutionService: composedResolutionService,
  async emitTelemetry(event) { resourceEvents.push(event); },
  clock: createNumericClock(4000, 5),
  schedule(task) { scheduled.push(task); },
});
const response = new FakeResponse(206);
let nextCalls = 0;
middleware({
  auth: { mode: "user_jwt", user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-a", resourceKey: "brands", resourceId: "brand-a" },
  headers: { authorization: "Bearer must-not-leak" },
}, response, () => { nextCalls += 1; });
assert.equal(nextCalls, 1);
response.emit("finish");
await runScheduled(scheduled);
assert.equal(response.statusCode, 206);
assert.equal(capsuleEvents.length, 1);
assert.equal(capsuleEvents[0].capsuleOutcome, "matched");
assert.equal(resourceEvents.length, 1);
assert.equal(resourceEvents[0].outcome, "matched");
assert.equal(resourceEvents[0].legacyResponseModified, false);
assert.equal(JSON.stringify({ capsuleEvents, resourceEvents }).includes("must-not-leak"), false);

for (const [name, factory] of [
  ["resolutionService", () => createExecutionCapsuleShadowResolutionService({})],
  ["capsuleService", () => createExecutionCapsuleShadowResolutionService({
    resolutionService: { resolve() {} },
  })],
]) {
  assert.throws(factory, TypeError, `${name} configuration must fail closed`);
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(currentDirectory, "contextKernel", "integration", "executionCapsuleShadow.js"),
  "utf8",
);
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.doesNotMatch(source, /authorization|cookie|accessToken|refreshToken|credentialPayload/i);
assert.match(source, /providerDispatchPerformed: false/);
assert.match(source, /legacyResolutionModified: false/);
assert.match(source, /executionAllowed: false/);
assert.match(source, /automaticWritePerformed: false/);
assert.match(source, /execution_capsule_shadow_target_mismatch/);
assert.match(source, /STATUS_TOKEN_PATTERN/);

console.log("execution capsule shadow adapter tests passed");
