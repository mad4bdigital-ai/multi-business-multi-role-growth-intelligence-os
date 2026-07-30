import assert from "node:assert/strict";

import { createContextResolutionService } from "./contextKernel/application/contextResolutionService.js";

const principal = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  authorizedTenantRefs: ["tenant-a"],
});

const effectiveSubject = Object.freeze({
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
});

const resource = Object.freeze({
  sourceType: "workspace_resource_grant",
  stableRef: "resource-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  resourceType: "workspace",
  resourceRef: "workspace-a",
  permission: "view",
  authoritySource: "membership_default",
});

function createHarness(readiness) {
  const calls = [];
  const service = createContextResolutionService({
    authorizedScopeRepository: {
      async findAuthorizedScope({ tenantRef, userRef }) {
        calls.push("authorized_scope");
        assert.equal(tenantRef, "tenant-a");
        assert.equal(userRef, "user-a");
        return {
          tenantRef,
          userRef,
          membership: { role: "member", status: "active" },
          workspaces: [{ workspaceRef: "workspace-a" }],
        };
      },
    },
    resourceGraphRepository: {
      async listAuthorizedResources() {
        calls.push("resource_graph");
        return [resource];
      },
    },
    capabilityReadinessRepository: {
      async findCapabilityReadiness({ capabilityKey }) {
        calls.push("semantic_capability");
        assert.equal(capabilityKey, "repository.read");
        return readiness;
      },
    },
    exactConnectionRepository: {
      async findExactConnection(input) {
        calls.push("provider_selection");
        assert.deepEqual(input, {
          tenantRef: "tenant-a",
          workspaceRef: "workspace-a",
          connectionRef: "connection-a",
          appKey: "github",
          actionKey: "repository.read",
          userRef: "user-a",
        });
        return null;
      },
    },
    contextPinRepository: {
      async findContextPin() {
        throw new Error("context pin lookup must not occur without pinRef");
      },
      async createPin() {
        throw new Error("T013 resolution must not create a context pin");
      },
      async invalidatePin() {
        throw new Error("T013 resolution must not invalidate a context pin");
      },
    },
  });
  return { calls, service };
}

function resolutionInput() {
  return {
    principal,
    effectiveSubject,
    capabilityKey: "repository.read",
    connectionRef: "connection-a",
    appKey: "github",
    actionKey: "repository.read",
    operationIntent: "repository_read",
    operationKind: "read",
    riskClass: "read",
    explicitRef: "resource-a",
    now: new Date("2030-01-01T00:00:00.000Z"),
  };
}

const missingHarness = createHarness(null);
const missing = await missingHarness.service.resolve(resolutionInput());
assert.equal(missing.status, "blocked");
assert.deepEqual(missing.reasonCodes, ["capability_readiness_not_found"]);
assert.deepEqual(missingHarness.calls, [
  "authorized_scope",
  "resource_graph",
  "semantic_capability",
]);
assert.equal(missing.automaticWritePerformed, false);
assert.equal(missing.secretsIncluded, false);

const hardBlockedHarness = createHarness({
  capabilityKey: "repository.read",
  runtimeStatus: "active",
  operationClass: "read",
  riskClass: "read",
  dispatchAllowed: true,
  applyAllowed: false,
  hardBlockCount: 1,
  currentManifest: { manifestHash: "manifest-a", manifestVersion: 1 },
});
const hardBlocked = await hardBlockedHarness.service.resolve(resolutionInput());
assert.equal(hardBlocked.status, "blocked");
assert.deepEqual(hardBlocked.reasonCodes, ["capability_hard_blocked"]);
assert.deepEqual(hardBlockedHarness.calls, [
  "authorized_scope",
  "resource_graph",
  "semantic_capability",
]);
assert.equal(hardBlocked.automaticWritePerformed, false);
assert.equal(hardBlocked.secretsIncluded, false);

const dispatchBlockedHarness = createHarness({
  capabilityKey: "repository.read",
  runtimeStatus: "active",
  operationClass: "read",
  riskClass: "read",
  dispatchAllowed: false,
  applyAllowed: false,
  hardBlockCount: 0,
  currentManifest: { manifestHash: "manifest-b", manifestVersion: 2 },
});
const dispatchBlocked = await dispatchBlockedHarness.service.resolve(resolutionInput());
assert.equal(dispatchBlocked.status, "blocked");
assert.deepEqual(dispatchBlocked.reasonCodes, ["capability_dispatch_not_allowed"]);
assert.deepEqual(dispatchBlockedHarness.calls, [
  "authorized_scope",
  "resource_graph",
  "semantic_capability",
]);
assert.equal(dispatchBlocked.automaticWritePerformed, false);
assert.equal(dispatchBlocked.secretsIncluded, false);

const allowedHarness = createHarness({
  capabilityKey: "repository.read",
  runtimeStatus: "active",
  operationClass: "read",
  riskClass: "read",
  dispatchAllowed: true,
  applyAllowed: false,
  hardBlockCount: 0,
  currentManifest: { manifestHash: "manifest-c", manifestVersion: 3 },
});
const allowed = await allowedHarness.service.resolve(resolutionInput());
assert.deepEqual(allowedHarness.calls, [
  "authorized_scope",
  "resource_graph",
  "semantic_capability",
  "provider_selection",
]);
assert.equal(allowed.automaticWritePerformed, false);
assert.equal(allowed.secretsIncluded, false);

console.log("context kernel semantic capability ordering tests passed");
