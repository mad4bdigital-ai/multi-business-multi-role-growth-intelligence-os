import assert from "node:assert/strict";

import { evaluateBoundedResourceGraph } from "./contextKernel/domain/resourceGraphPolicy.js";

const NOW = new Date("2030-01-01T00:00:00.000Z");

function node(nodeRef, resourceType, resourceRef, overrides = {}) {
  return {
    nodeRef,
    resourceType,
    resourceRef,
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    status: "active",
    ...overrides,
  };
}

function edge(edgeRef, sourceNodeRef, targetNodeRef, overrides = {}) {
  return {
    edgeRef,
    sourceNodeRef,
    targetNodeRef,
    relationType: "contains",
    inheritancePolicyKey: "inherit_read",
    status: "active",
    ...overrides,
  };
}

function restriction(restrictionRef, nodeRef, overrides = {}) {
  return {
    restrictionRef,
    nodeRef,
    effect: "deny",
    operations: ["read"],
    reasonCode: "RESOURCE_EXPLICITLY_RESTRICTED",
    status: "active",
    ...overrides,
  };
}

const baseSnapshot = {
  sourceRef: "resource-graph-property-fixture",
  versionRef: "graph-property-v1",
  stale: false,
  nodes: [
    node("workspace:root", "workspace", "workspace-a"),
    node("project:a", "project", "project-a"),
    node("asset:b", "asset", "asset-b"),
  ],
  edges: [
    edge("edge:root-a", "workspace:root", "project:a"),
    edge("edge:a-b", "project:a", "asset:b"),
    edge("edge:b-root", "asset:b", "workspace:root"),
  ],
  restrictions: [],
};

function evaluate(snapshot = baseSnapshot, overrides = {}) {
  return evaluateBoundedResourceGraph({
    snapshot,
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    rootNodeRef: "workspace:root",
    rootResourceType: "workspace",
    rootResourceRef: "workspace-a",
    relationTypes: ["contains"],
    inheritancePolicyKeys: ["inherit_read"],
    operationIntent: "read",
    maxDepth: 8,
    maxNodes: 20,
    now: NOW,
    ...overrides,
  });
}

function projection(result) {
  return {
    status: result.status,
    reasonCodes: result.reasonCodes,
    nodes: result.nodes?.map(({ nodeRef, depth }) => ({ nodeRef, depth })) ?? [],
    edges: result.edges?.map(({ edgeRef }) => edgeRef) ?? [],
    blockedBranches: result.blockedBranches ?? [],
  };
}

const canonical = evaluate();
const permuted = evaluate({
  ...baseSnapshot,
  nodes: [...baseSnapshot.nodes].reverse(),
  edges: [baseSnapshot.edges[2], baseSnapshot.edges[0], baseSnapshot.edges[1]],
  restrictions: [...baseSnapshot.restrictions].reverse(),
});
assert.deepEqual(projection(permuted), projection(canonical));
assert.deepEqual(canonical.nodes.map(({ nodeRef }) => nodeRef), ["asset:b", "project:a", "workspace:root"]);
assert.equal(new Set(canonical.nodes.map(({ nodeRef }) => nodeRef)).size, canonical.nodes.length, "cycles must not duplicate nodes");
assert.equal(canonical.authorityGranted, false);
assert.equal(canonical.runtimeAuthorityChanged, false);
assert.equal(canonical.providerCallMade, false);
assert.equal(canonical.credentialPayloadRead, false);
assert.equal(canonical.secretsIncluded, false);

const branchDenied = evaluate({
  ...baseSnapshot,
  restrictions: [restriction("restriction:a", "project:a")],
});
assert.equal(branchDenied.status, "resolved");
assert.deepEqual(branchDenied.nodes.map(({ nodeRef }) => nodeRef), ["workspace:root"]);
assert.deepEqual(branchDenied.edges, []);
assert.deepEqual(branchDenied.blockedBranches, [{
  nodeRef: "project:a",
  viaEdgeRef: "edge:root-a",
  reasonCodes: ["RESOURCE_EXPLICITLY_RESTRICTED"],
  restrictionRefs: ["restriction:a"],
}]);
assert.ok(branchDenied.reasonCodes.includes("RESOURCE_GRAPH_BRANCH_RESTRICTED"));

const wildcardDenied = evaluate({
  ...baseSnapshot,
  restrictions: [restriction("restriction:root-wildcard", "workspace:root", { operations: ["*"] })],
}, { operationIntent: "write" });
assert.equal(wildcardDenied.status, "blocked");
assert.ok(wildcardDenied.reasonCodes.includes("RESOURCE_GRAPH_ROOT_RESTRICTED"));
assert.ok(wildcardDenied.reasonCodes.includes("RESOURCE_EXPLICITLY_RESTRICTED"));

const operationMismatch = evaluate({
  ...baseSnapshot,
  restrictions: [restriction("restriction:a-write", "project:a", { operations: ["write"] })],
});
assert.equal(operationMismatch.status, "resolved");
assert.deepEqual(operationMismatch.blockedBranches, []);
assert.ok(operationMismatch.nodes.some(({ nodeRef }) => nodeRef === "project:a"));

for (const inactiveRestriction of [
  restriction("restriction:a-expired", "project:a", { validUntil: "2029-12-31T23:59:59.000Z" }),
  restriction("restriction:a-revoked", "project:a", { revokedAt: "2029-12-31T23:00:00.000Z" }),
]) {
  const result = evaluate({ ...baseSnapshot, restrictions: [inactiveRestriction] });
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.blockedBranches, []);
  assert.ok(result.nodes.some(({ nodeRef }) => nodeRef === "project:a"));
}

const crossTenant = evaluate({
  ...baseSnapshot,
  nodes: [...baseSnapshot.nodes, node("foreign:x", "asset", "asset-x", { tenantRef: "tenant-b", workspaceRef: "workspace-b" })],
});
assert.equal(crossTenant.status, "blocked");
assert.deepEqual(crossTenant.reasonCodes, ["RESOURCE_GRAPH_CROSS_TENANT_NODE"]);

const depthBound = evaluate(baseSnapshot, { maxDepth: 1 });
assert.deepEqual(depthBound.nodes.map(({ nodeRef }) => nodeRef), ["project:a", "workspace:root"]);
assert.deepEqual(depthBound.edges.map(({ edgeRef }) => edgeRef), ["edge:root-a"]);
assert.ok(depthBound.reasonCodes.includes("RESOURCE_GRAPH_DEPTH_BOUND_REACHED"));

const wrongInheritance = evaluate({
  ...baseSnapshot,
  edges: [
    edge("edge:root-a", "workspace:root", "project:a", { inheritancePolicyKey: "inherit_write" }),
    edge("edge:a-b", "project:a", "asset:b"),
  ],
});
assert.deepEqual(wrongInheritance.nodes.map(({ nodeRef }) => nodeRef), ["workspace:root"]);
assert.deepEqual(wrongInheritance.edges, []);
assert.ok(wrongInheritance.reasonCodes.includes("RESOURCE_GRAPH_INHERITANCE_POLICY_NOT_ALLOWED"));

const rootDenied = evaluate({
  ...baseSnapshot,
  restrictions: [
    restriction("restriction:b", "asset:b"),
    restriction("restriction:root", "workspace:root", { reasonCode: "ROOT_AUTHORITY_DENIED" }),
  ],
});
assert.equal(rootDenied.status, "blocked");
assert.deepEqual(rootDenied.reasonCodes, ["RESOURCE_GRAPH_ROOT_RESTRICTED", "ROOT_AUTHORITY_DENIED"]);
assert.equal(rootDenied.authorityGranted, false);
assert.equal(rootDenied.runtimeAuthorityChanged, false);
assert.equal(rootDenied.automaticWritePerformed, false);
assert.equal(rootDenied.providerCallMade, false);
assert.equal(rootDenied.credentialPayloadRead, false);
assert.equal(rootDenied.secretsIncluded, false);

console.log("context kernel resource graph property invariants passed");
