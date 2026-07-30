import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";
import { createExecutionCapsuleResourceApiShadowComposition } from "./contextKernel/integration/index.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";

function createResolution({
  tenantRef = "tenant-a",
  workspaceRef = "workspace-a",
  brandRef = null,
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
  return Object.freeze({
    status: "resolved",
    reasonCodes: [],
    selectedCandidate,
    candidates: [selectedCandidate],
    authorityScope: Object.freeze({ tenantRef, role: "member" }),
    capabilityReadiness,
    context: Object.freeze({
      contextHash: `context-hash-${resourceRef}`,
      contextRevision: `context-revision-${resourceRef}`,
      principal: Object.freeze({
        principalType: "tenant_user",
        principalRef: "principal-a",
      }),
      effectiveSubject: Object.freeze({
        subjectRef: "subject-a",
        tenantRef,
        workspaceRef,
      }),
      tenantRef,
      workspaceRef,
      brandRef,
      resourceType,
      resourceRef,
      connectionRef,
      selectedCandidate,
      capability: capabilityReadiness,
    }),
  });
}

function evidenceFor(resolution) {
  return Object.freeze({
    authorityPathRef: `authority-path-${resolution.context.resourceRef}`,
    authorityRevision: "authority-revision-a",
    capabilityRevision: "capability-revision-a",
    registryRevision: "registry-revision-a",
    credentialReadinessRevision: "credential-readiness-revision-a",
    invalidationDependencies: [],
  });
}

function createNumericClock(start = 1000, increment = 2) {
  let current = start;
  return () => {
    const value = current;
    current += increment;
    return value;
  };
}

class FakeResponse extends EventEmitter {
  constructor(statusCode = 200) {
    super();
    this.statusCode = statusCode;
  }
}

async function runScheduled(queue) {
  while (queue.length > 0) await queue.shift()();
}

const samples = Object.freeze([
  createResolution({ resourceRef: "repository-a", connectionRef: "connection-a" }),
  createResolution({ resourceRef: "repository-b", connectionRef: "connection-b" }),
  createResolution({
    brandRef: "brand-a",
    resourceType: "brand",
    resourceRef: "brand-a",
    connectionRef: "connection-brand-a",
    capabilityKey: "brand.read",
  }),
]);

const legacyResolutionService = Object.freeze({
  async resolve(input = {}) {
    const sampleIndex = Number.isInteger(input.sampleIndex) ? input.sampleIndex : 0;
    return samples[sampleIndex] || samples[0];
  },
});

const disabled = createExecutionCapsuleResourceApiShadowComposition({
  enabled: false,
  resolutionService: legacyResolutionService,
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.mode, "disabled");
assert.equal(disabled.resolutionService, legacyResolutionService);
assert(Object.isFrozen(disabled));
let disabledNextCalls = 0;
const disabledResponse = new FakeResponse();
disabled.resourceApiShadowMiddleware({}, disabledResponse, () => { disabledNextCalls += 1; });
disabledResponse.emit("finish");
assert.equal(disabledNextCalls, 1, "default-off composition must be transparent");

const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(ISSUED_AT),
  defaultTtlMs: 10 * 60 * 1000,
});
const capsuleEvents = [];
const resourceEvents = [];
const scheduled = [];
const composition = createExecutionCapsuleResourceApiShadowComposition({
  enabled: true,
  resolutionService: legacyResolutionService,
  capsuleService,
  async capsuleEvidenceProvider({ resolution }) {
    return evidenceFor(resolution);
  },
  async emitCapsuleTelemetry(event) { capsuleEvents.push(event); },
  async emitResourceTelemetry(event) { resourceEvents.push(event); },
  clock: createNumericClock(2000, 3),
  schedule(task) { scheduled.push(task); },
});

assert.equal(composition.enabled, true);
assert.equal(composition.mode, "execution_capsule_shadow");
assert.notEqual(composition.resolutionService, legacyResolutionService);
assert(Object.isFrozen(composition));

for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
  const returned = await composition.resolutionService.resolve({ sampleIndex });
  assert.equal(
    returned,
    samples[sampleIndex],
    "selected shadow composition must preserve each legacy result by identity",
  );
}

const controlledParityEvents = capsuleEvents.slice(0, samples.length);
assert.equal(controlledParityEvents.length, 3);
assert.equal(controlledParityEvents.every((event) => event.capsuleOutcome === "matched"), true);
assert.equal(controlledParityEvents.every((event) => event.capsuleTargetMatched === true), true);
assert.equal(controlledParityEvents.every((event) => event.providerDispatchPerformed === false), true);
assert.equal(controlledParityEvents.every((event) => event.legacyResolutionModified === false), true);
assert.equal(controlledParityEvents.every((event) => event.executionAllowed === false), true);
assert.equal(controlledParityEvents.every((event) => event.automaticWritePerformed === false), true);
assert.equal(controlledParityEvents.every((event) => event.secretsIncluded === false), true);

const response = new FakeResponse(206);
let nextCalls = 0;
composition.resourceApiShadowMiddleware({
  auth: { mode: "user_jwt", user_id: "user-a", tenant_id: "tenant-a" },
  params: {
    tenant_id: "tenant-a",
    resourceKey: "repositories",
    resourceId: "repository-a",
  },
  headers: { authorization: "Bearer must-never-appear" },
}, response, () => { nextCalls += 1; });
assert.equal(nextCalls, 1);
response.emit("finish");
await runScheduled(scheduled);
assert.equal(response.statusCode, 206);
assert.equal(resourceEvents.length, 1);
assert.equal(resourceEvents[0].outcome, "matched");
assert.equal(resourceEvents[0].legacyResponseModified, false);
assert.equal(resourceEvents[0].providerDispatchPerformed, false);
assert.equal(JSON.stringify({ capsuleEvents, resourceEvents }).includes("must-never-appear"), false);

const rolledBack = composition.rollback();
assert.equal(rolledBack.enabled, false);
assert.equal(rolledBack.mode, "disabled");
assert.equal(
  rolledBack.resolutionService,
  legacyResolutionService,
  "rollback must restore the exact pre-EC1 resolution service",
);
const scheduledBeforeRollbackProbe = scheduled.length;
let rollbackNextCalls = 0;
const rollbackResponse = new FakeResponse(204);
rolledBack.resourceApiShadowMiddleware({}, rollbackResponse, () => { rollbackNextCalls += 1; });
rollbackResponse.emit("finish");
assert.equal(rollbackNextCalls, 1);
assert.equal(
  scheduled.length,
  scheduledBeforeRollbackProbe,
  "rollback must restore the prior path without scheduling shadow work",
);

assert.throws(
  () => createExecutionCapsuleResourceApiShadowComposition({ enabled: false }),
  TypeError,
  "even default-off composition requires the exact legacy resolution service",
);
assert.throws(
  () => createExecutionCapsuleResourceApiShadowComposition({
    enabled: true,
    resolutionService: legacyResolutionService,
  }),
  TypeError,
  "enabled composition must fail closed when capsule dependencies are absent",
);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(
    currentDirectory,
    "contextKernel",
    "integration",
    "executionCapsuleShadowComposition.js",
  ),
  "utf8",
);
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.doesNotMatch(source, /authorization|cookie|accessToken|refreshToken|credentialPayload/i);
assert.doesNotMatch(source, /routes\//i);
assert.match(source, /enabled = false/);
assert.match(source, /rollback\(\)/);

console.log("execution capsule shadow composition tests passed");
