import assert from "node:assert/strict";

import { createResourceGraphResolverService } from "./contextKernel/application/index.js";

const now = new Date("2026-07-30T10:00:00.000Z");
const principal = {
  principalType: "tenant_user",
  principalRef: "user-a",
  authorizedTenantRefs: ["tenant-a"],
};
const effectiveSubject = {
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
};
const rootNode = {
  nodeRef: "workspace:workspace-a",
  resourceType: "workspace",
  resourceRef: "workspace-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  status: "active",
};

function input(overrides = {}) {
  return {
    principal,
    effectiveSubject,
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
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    sourceRef: "graph-source",
    versionRef: "graph-v1",
    stale: false,
    nodes: [rootNode],
    edges: [],
    restrictions: [],
    ...overrides,
  };
}

function resolverFor(value) {
  return createResourceGraphResolverService({
    boundedResourceGraphRepository: {
      async findBoundedResourceGraph() {
        return typeof value === "function" ? value() : value;
      },
    },
  });
}

async function expectBlocked(value, code, overrides = {}) {
  const result = await resolverFor(value).resolve(input(overrides));
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCodes.includes(code), true, `${code} must be present`);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
  assert.equal(Object.isFrozen(result), true);
}

await assert.rejects(
  () => resolverFor(snapshot()).resolve(input({
    principal: { ...principal, authorizedTenantRefs: ["tenant-b"] },
  })),
  (error) => error.code === "resource_graph_tenant_not_authorized",
);
await assert.rejects(
  () => resolverFor(snapshot()).resolve(input({
    effectiveSubject: { ...effectiveSubject, tenantRef: "tenant-b" },
    tenantRef: "tenant-a",
  })),
  (error) => error.code === "resource_graph_subject_tenant_mismatch",
);
await assert.rejects(
  () => resolverFor(snapshot()).resolve(input({ workspaceRef: "workspace-b" })),
  (error) => error.code === "resource_graph_subject_workspace_mismatch",
);
await assert.rejects(
  () => resolverFor(null).resolve(input()),
  (error) => error.code === "resource_graph_snapshot_not_found",
);

await expectBlocked(snapshot({ stale: true }), "RESOURCE_GRAPH_SNAPSHOT_STALE");
await expectBlocked(
  snapshot({ nodes: [{ ...rootNode, resourceRef: "workspace-other" }] }),
  "RESOURCE_GRAPH_ROOT_IDENTITY_MISMATCH",
);
await assert.rejects(
  () => resolverFor(snapshot({
    restrictions: [{
      restrictionRef: "restriction-unknown-status",
      nodeRef: "workspace:workspace-a",
      effect: "deny",
      operations: ["read"],
      reasonCode: "UNKNOWN_STATUS_MUST_BLOCK",
      status: "pending",
    }],
  })).resolve(input()),
  /Unsupported resource graph restriction status: pending/,
);
await expectBlocked(
  snapshot({ nodes: [rootNode, { ...rootNode }] }),
  "RESOURCE_GRAPH_NODE_REFERENCE_AMBIGUOUS",
);
await expectBlocked(
  snapshot({
    nodes: [rootNode, {
      ...rootNode,
      nodeRef: "project:project-b",
      resourceType: "project",
      resourceRef: "project-b",
      tenantRef: "tenant-b",
    }],
  }),
  "RESOURCE_GRAPH_CROSS_TENANT_NODE",
);
await expectBlocked(
  snapshot({
    nodes: [rootNode, {
      ...rootNode,
      nodeRef: "project:project-b",
      resourceType: "project",
      resourceRef: "project-b",
      workspaceRef: "workspace-b",
    }],
  }),
  "RESOURCE_GRAPH_CROSS_WORKSPACE_NODE",
);
await expectBlocked(
  snapshot({
    edges: [{
      edgeRef: "edge-missing-target",
      sourceNodeRef: "workspace:workspace-a",
      targetNodeRef: "project:missing",
      relationType: "contains",
      inheritancePolicyKey: "inherit_read",
      status: "active",
    }],
  }),
  "RESOURCE_GRAPH_EDGE_NODE_NOT_FOUND",
);
await expectBlocked(
  snapshot({
    restrictions: [{
      restrictionRef: "restriction-root",
      nodeRef: "workspace:workspace-a",
      effect: "deny",
      operations: ["read"],
      reasonCode: "ROOT_ACCESS_RESTRICTED",
      status: "active",
    }],
  }),
  "RESOURCE_GRAPH_ROOT_RESTRICTED",
);
await expectBlocked(
  snapshot({
    nodes: [
      rootNode,
      {
        ...rootNode,
        nodeRef: "project:project-a",
        resourceType: "project",
        resourceRef: "project-a",
      },
    ],
  }),
  "RESOURCE_GRAPH_NODE_LIMIT_EXCEEDED",
  { maxNodes: 1 },
);

const cycleResult = await resolverFor(snapshot({
  nodes: [
    rootNode,
    {
      ...rootNode,
      nodeRef: "project:project-a",
      resourceType: "project",
      resourceRef: "project-a",
    },
  ],
  edges: [
    {
      edgeRef: "edge-root-project",
      sourceNodeRef: "workspace:workspace-a",
      targetNodeRef: "project:project-a",
      relationType: "contains",
      inheritancePolicyKey: "inherit_read",
      status: "active",
    },
    {
      edgeRef: "edge-project-root",
      sourceNodeRef: "project:project-a",
      targetNodeRef: "workspace:workspace-a",
      relationType: "contains",
      inheritancePolicyKey: "inherit_read",
      status: "active",
    },
  ],
})).resolve(input());
assert.equal(cycleResult.status, "resolved");
assert.deepEqual(cycleResult.nodes.map((node) => node.nodeRef), [
  "project:project-a",
  "workspace:workspace-a",
]);

assert.throws(
  () => createResourceGraphResolverService({ boundedResourceGraphRepository: {} }),
  /Bounded resource graph repository is missing methods: findBoundedResourceGraph/,
);
await assert.rejects(
  () => resolverFor(snapshot()).resolve(input({ maxDepth: 9 })),
  /maxDepth must be an integer between 0 and 8/,
);

console.log("context kernel bounded resource graph fail-closed tests passed");
