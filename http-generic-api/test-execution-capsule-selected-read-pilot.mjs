import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionCapsuleService } from "./contextKernel/application/executionCapsuleService.js";
import { createExecutionCapsuleSelectedReadPilot } from "./contextKernel/api/index.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return value;
    },
    send(value) {
      this.body = value;
      return value;
    },
    end() {
      return undefined;
    },
  };
}

function numericClock(start = 1000, increment = 5) {
  let current = start;
  return () => {
    const value = current;
    current += increment;
    return value;
  };
}

const selectedCandidate = Object.freeze({
  candidateType: "connection",
  stableRef: "connection-a",
  displayLabel: "Selected connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  brandRef: "brand-a",
  resourceType: "repository",
  resourceRef: "repository-a",
  connectionRef: "connection-a",
  metadata: {
    appKey: "github",
    actionGrantRef: "grant-a",
    accessToken: "must-never-appear",
  },
});

const capabilityReadiness = Object.freeze({
  capabilityKey: "repository.read",
  runtimeStatus: "active",
  operationClass: "read",
  riskClass: "read",
  dispatchAllowed: true,
  applyAllowed: false,
  hardBlockCount: 0,
  manifestHash: "manifest-a",
  manifestVersion: 1,
  credentialPayload: "must-never-appear",
});

const resolution = Object.freeze({
  resolutionId: "resolution-a",
  status: "resolved",
  reasonCodes: [],
  contextRevision: "context-revision-a",
  contextHash: "a".repeat(64),
  selectedCandidate,
  selectedContext: {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: "brand-a",
    resourceType: "repository",
    resourceRef: "repository-a",
    connectionRef: "connection-a",
  },
  candidates: [selectedCandidate],
  authorityScope: {
    tenantRef: "tenant-a",
    role: "owner",
  },
  capabilityReadiness,
  context: {
    contextHash: "a".repeat(64),
    contextRevision: "context-revision-a",
    principal: {
      principalType: "tenant_user",
      principalRef: "user-a",
    },
    effectiveSubject: {
      subjectRef: "user-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
    },
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: "brand-a",
    resourceType: "repository",
    resourceRef: "repository-a",
    connectionRef: "connection-a",
    selectedCandidate,
    capability: capabilityReadiness,
    credentials: { accessToken: "must-never-appear" },
  },
  automaticWritePerformed: false,
  secretsIncluded: false,
});

const operationCalls = [];
const operations = {
  async createContextResolution() {
    throw new Error("not used by EC2 selected read pilot");
  },
  async getContextResolution(input) {
    operationCalls.push(input);
    return resolution;
  },
  async createContextPin() {
    throw new Error("not used by EC2 selected read pilot");
  },
  async deleteContextPin() {
    throw new Error("not used by EC2 selected read pilot");
  },
  async createExecutionContext() {
    throw new Error("not used by EC2 selected read pilot");
  },
  async validateExecutionContext() {
    throw new Error("not used by EC2 selected read pilot");
  },
};

const principalContext = Object.freeze({
  principal: {
    principalType: "tenant_user",
    principalRef: "user-a",
  },
  effectiveSubject: {
    subjectRef: "user-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  },
});

const resolvePrincipalContext = () => principalContext;
const capsuleService = createExecutionCapsuleService({
  clock: () => new Date(ISSUED_AT),
  defaultTtlMs: 10 * 60 * 1000,
});
const evidenceViews = [];
const events = [];
const pilot = createExecutionCapsuleSelectedReadPilot({
  enabled: true,
  operations,
  capsuleService,
  async capsuleEvidenceProvider({ resolution: observed, resolutionInput, viewMode }) {
    assert.equal(observed, resolution);
    assert.equal(resolutionInput.resolutionId, "resolution-a");
    evidenceViews.push(viewMode);
    return {
      authorityPathRef: "authority-path-a",
      authorityRevision: "authority-revision-a",
      capabilityRevision: "capability-revision-a",
      registryRevision: "registry-revision-a",
      credentialReadinessRevision: "credential-readiness-revision-a",
      invalidationDependencies: [],
    };
  },
  async emitTelemetry(event) {
    events.push(event);
  },
  clock: numericClock(),
  resolvePrincipalContext,
});

assert.equal(pilot.enabled, true);
assert.equal(pilot.mode, "execution_capsule_selected_read_pilot");
assert.equal(pilot.tenant.viewMode, "tenant");
assert.equal(pilot.admin.viewMode, "admin");
assert.notEqual(pilot.tenant.operations, operations);
assert.notEqual(pilot.admin.operations, operations);

const directInput = {
  resolutionId: "resolution-a",
  page: { limit: 25, cursor: null },
  principalContext,
};
assert.equal(
  await pilot.tenant.operations.getContextResolution(directInput),
  resolution,
  "Tenant pilot must preserve the exact legacy resolution object",
);
assert.equal(
  await pilot.admin.operations.getContextResolution(directInput),
  resolution,
  "Admin pilot must preserve the exact legacy resolution object",
);
assert.deepEqual(evidenceViews, ["tenant", "admin"]);
assert.equal(events.length, 2);
for (const event of events) {
  assert.equal(event.pilotType, "execution_capsule_selected_read");
  assert.equal(event.capsuleOutcome, "matched");
  assert.equal(event.capsuleTargetMatched, true);
  assert.equal(event.providerDispatchPerformed, false);
  assert.equal(event.legacyResolutionModified, false);
  assert.equal(event.executionAllowed, false);
  assert.equal(event.automaticWritePerformed, false);
  assert.equal(event.secretsIncluded, false);
  assert(Object.isFrozen(event));
}

evidenceViews.length = 0;
events.length = 0;

const disabled = createExecutionCapsuleSelectedReadPilot({
  operations,
  resolvePrincipalContext,
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.tenant.operations, operations);
assert.equal(disabled.admin.operations, operations);

const request = {
  params: { resolutionId: "resolution-a" },
  query: { candidateLimit: "25" },
  requestId: "request-a",
};
const baselineTenantResponse = createResponse();
const baselineAdminResponse = createResponse();
await disabled.tenant.controller.getContextResolution(request, baselineTenantResponse);
await disabled.admin.controller.getContextResolution(request, baselineAdminResponse);

const pilotTenantResponse = createResponse();
const pilotAdminResponse = createResponse();
await pilot.tenant.controller.getContextResolution(request, pilotTenantResponse);
await pilot.admin.controller.getContextResolution(request, pilotAdminResponse);

assert.deepEqual(pilotTenantResponse, baselineTenantResponse);
assert.deepEqual(pilotAdminResponse, baselineAdminResponse);
assert.equal(pilotTenantResponse.statusCode, 200);
assert.equal(pilotAdminResponse.statusCode, 200);
assert.equal(Object.hasOwn(pilotTenantResponse.body, "authorityScope"), false);
assert.equal(Object.hasOwn(pilotTenantResponse.body, "capabilityReadiness"), false);
assert.equal(pilotAdminResponse.body.authorityScope.role, "owner");
assert.equal(pilotAdminResponse.body.capabilityReadiness.dispatchAllowed, true);
assert.equal(pilotAdminResponse.body.capabilityReadiness.applyAllowed, false);
assert.equal(
  Object.hasOwn(pilotAdminResponse.body.capabilityReadiness, "credentialPayload"),
  false,
);
assert.deepEqual(evidenceViews.sort(), ["admin", "tenant"]);
assert.equal(events.length, 2);
assert.deepEqual(events.map((event) => event.viewMode).sort(), ["admin", "tenant"]);
assert.equal(JSON.stringify({ events, tenant: pilotTenantResponse.body, admin: pilotAdminResponse.body }).includes("must-never-appear"), false);

const eventCountBeforeRollback = events.length;
const rolledBack = pilot.rollback();
assert.equal(rolledBack.enabled, false);
assert.equal(rolledBack.tenant.operations, operations);
assert.equal(rolledBack.admin.operations, operations);
const rollbackResponse = createResponse();
await rolledBack.tenant.controller.getContextResolution(request, rollbackResponse);
assert.equal(events.length, eventCountBeforeRollback, "Rollback must stop capsule parity telemetry.");
assert.deepEqual(rollbackResponse, baselineTenantResponse);

assert(operationCalls.length >= 7, "The legacy read operation must remain the sole read source.");

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(
  path.join(currentDirectory, "contextKernel", "api", "executionCapsuleSelectedReadPilot.js"),
  "utf8",
);
assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.doesNotMatch(source, /authorization|cookie|accessToken|refreshToken|credentialPayload/i);
assert.match(source, /enabled !== true/);
assert.match(source, /getContextResolution/);
assert.match(source, /execution_capsule_selected_read/);

console.log("execution capsule selected read pilot tests passed");
