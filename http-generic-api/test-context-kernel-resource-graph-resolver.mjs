import assert from "node:assert/strict";

import { createResourceGraphResolverService } from "./contextKernel/application/index.js";

const now = new Date("2026-07-30T10:00:00.000Z");
const calls = [];
const resolver = createResourceGraphResolverService({
  boundedResourceGraphRepository: {
    async findBoundedResourceGraph(query) {
      calls.push(query);
      return {
        sourceRef: "resource-graph-read-model",
        versionRef: "graph-v7",
        stale: false,
        nodes: [
          {
            nodeRef: "workspace:workspace-a",
            resourceType: "workspace",
            resourceRef: "workspace-a",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-a",
            status: "active",
            sourceRef: "workspace-row-a",
            versionRef: "workspace-v3",
            metadata: { safeValue: "keep-me", secret: "drop-me" },
          },
          {
            nodeRef: "project:project-a",
            resourceType: "project",
            resourceRef: "project-a",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-a",
            status: "active",
            sourceRef: "project-row-a",
            versionRef: "project-v2",
          },
          {
            nodeRef: "project:project-blocked",
            resourceType: "project",
            resourceRef: "project-blocked",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-a",
            status: "active",
          },
          {
            nodeRef: "project:project-policy-blocked",
            resourceType: "project",
            resourceRef: "project-policy-blocked",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-a",
            status: "active",
          },
        ],
        edges: [
          {
            edgeRef: "edge-workspace-project-a",
            sourceNodeRef: "workspace:workspace-a",
            targetNodeRef: "project:project-a",
            relationType: "contains",
            inheritancePolicyKey: "inherit_read",
            status: "active",
          },
          {
            edgeRef: "edge-workspace-project-blocked",
            sourceNodeRef: "workspace:workspace-a",
            targetNodeRef: "project:project-blocked",
            relationType: "contains",
            inheritancePolicyKey: "inherit_read",
            status: "active",
          },
          {
            edgeRef: "edge-workspace-project-policy-blocked",
            sourceNodeRef: "workspace:workspace-a",
            targetNodeRef: "project:project-policy-blocked",
            relationType: "contains",
            inheritancePolicyKey: "inherit_write",
            status: "active",
          },
        ],
        restrictions: [
          {
            restrictionRef: "restriction-project-blocked-read",
            nodeRef: "project:project-blocked",
            effect: "deny",
            operations: ["read"],
            reasonCode: "RESOURCE_EXPLICITLY_RESTRICTED",
            status: "active",
            sourceRef: "restriction-row-a",
            versionRef: "restriction-v1",
            token: "drop-me",
          },
        ],
        credentialPayload: { accessToken: "drop-me" },
      };
    },
  },
});

const result = await resolver.resolve({
  principal: {
    principalType: "tenant_user",
    principalRef: "user-a",
    authorizedTenantRefs: ["tenant-a"],
  },
  effectiveSubject: {
    subjectType: "tenant_user",
    subjectRef: "user-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  },
  rootResource: {
    nodeRef: "workspace:workspace-a",
    resourceType: "workspace",
    resourceRef: "workspace-a",
  },
  operationIntent: "read",
  relationTypes: ["contains"],
  inheritancePolicyKeys: ["inherit_read"],
  maxDepth: 3,
  maxNodes: 10,
  now,
});

assert.equal(result.status, "resolved");
assert.equal(result.authorityGranted, false);
assert.equal(result.runtimeAuthorityChanged, false);
assert.equal(result.automaticWritePerformed, false);
assert.equal(result.providerCallMade, false);
assert.equal(result.credentialPayloadRead, false);
assert.equal(result.secretsIncluded, false);
assert.deepEqual(
  result.nodes.map((node) => node.nodeRef),
  ["project:project-a", "workspace:workspace-a"],
);
assert.deepEqual(result.edges.map((edge) => edge.edgeRef), ["edge-workspace-project-a"]);
assert.deepEqual(result.blockedBranches, [
  {
    nodeRef: "project:project-blocked",
    viaEdgeRef: "edge-workspace-project-blocked",
    reasonCodes: ["RESOURCE_EXPLICITLY_RESTRICTED"],
    restrictionRefs: ["restriction-project-blocked-read"],
  },
]);
assert.deepEqual(result.reasonCodes, [
  "RESOURCE_GRAPH_BRANCH_RESTRICTED",
  "RESOURCE_GRAPH_INHERITANCE_POLICY_NOT_ALLOWED",
]);
assert.equal(result.nodes.find((node) => node.nodeRef === "workspace:workspace-a").metadata.safeValue, "keep-me");
assert.equal(
  Object.hasOwn(result.nodes.find((node) => node.nodeRef === "workspace:workspace-a").metadata, "secret"),
  false,
);
assert.equal(Object.hasOwn(result, "credentialPayload"), false);
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.nodes), true);
assert.equal(Object.isFrozen(result.nodes[0]), true);

assert.equal(calls.length, 1);
assert.deepEqual(calls[0], {
  principalRef: "user-a",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  rootNodeRef: "workspace:workspace-a",
  rootResourceType: "workspace",
  rootResourceRef: "workspace-a",
  operationIntent: "read",
  relationTypes: ["contains"],
  inheritancePolicyKeys: ["inherit_read"],
  maxDepth: 3,
  maxNodes: 10,
});

console.log("context kernel bounded resource graph resolver tests passed");
