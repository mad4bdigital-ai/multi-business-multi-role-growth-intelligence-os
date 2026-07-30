import { deepFreeze } from "./model.js";

export const RESOURCE_GRAPH_LIMITS = deepFreeze({
  defaultMaxDepth: 3,
  absoluteMaxDepth: 8,
  defaultMaxNodes: 100,
  absoluteMaxNodes: 250,
  maxRelationTypes: 16,
  maxInheritancePolicyKeys: 32,
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,190}$/;

function requireString(value, field, maximumLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`);
  if (normalized.length > maximumLength) {
    throw new TypeError(`${field} must not exceed ${maximumLength} characters.`);
  }
  return normalized;
}

function requireIdentifier(value, field) {
  const normalized = requireString(value, field);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a stable identifier.`);
  }
  return normalized;
}

function optionalIdentifier(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return requireIdentifier(value, field);
}

function normalizeBound(value, field, fallback, absoluteMaximum, minimum = 1) {
  const normalized = value === null || value === undefined ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > absoluteMaximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${absoluteMaximum}.`);
  }
  return normalized;
}

function normalizeIdentifierSet(values, field, maximumCount) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must contain at least one value.`);
  }
  const normalized = [...new Set(values.map((value) => requireIdentifier(value, field)))].sort();
  if (normalized.length > maximumCount) {
    throw new TypeError(`${field} must not contain more than ${maximumCount} values.`);
  }
  return normalized;
}

function normalizeTimestamp(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${field} must be a valid timestamp.`);
  return parsed;
}

function recordIsActive(record, now) {
  if (String(record.status || "").toLowerCase() !== "active") return false;
  if (record.revokedAt) return false;
  const validFrom = normalizeTimestamp(record.validFrom, "record.validFrom");
  const validUntil = normalizeTimestamp(record.validUntil || record.expiresAt, "record.validUntil");
  if (validFrom && now.getTime() < validFrom.getTime()) return false;
  if (validUntil && now.getTime() >= validUntil.getTime()) return false;
  return true;
}

function blocked(reasonCodes, details = {}) {
  return deepFreeze({
    status: "blocked",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ...details,
    authorityGranted: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

function normalizeNode(record, tenantRef) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("resource graph nodes must be objects.");
  }
  return {
    nodeRef: requireIdentifier(record.nodeRef, "node.nodeRef"),
    resourceType: requireIdentifier(record.resourceType, "node.resourceType"),
    resourceRef: requireIdentifier(record.resourceRef, "node.resourceRef"),
    tenantRef: requireIdentifier(record.tenantRef, "node.tenantRef"),
    workspaceRef: optionalIdentifier(record.workspaceRef, "node.workspaceRef"),
    status: requireIdentifier(record.status, "node.status").toLowerCase(),
    revokedAt: record.revokedAt || null,
    validFrom: record.validFrom || null,
    validUntil: record.validUntil || record.expiresAt || null,
    sourceRef: optionalIdentifier(record.sourceRef, "node.sourceRef"),
    versionRef: optionalIdentifier(record.versionRef, "node.versionRef"),
    metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? { ...record.metadata }
      : {},
    tenantMismatch: record.tenantRef !== tenantRef,
  };
}

function normalizeEdge(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("resource graph edges must be objects.");
  }
  return {
    edgeRef: requireIdentifier(record.edgeRef, "edge.edgeRef"),
    sourceNodeRef: requireIdentifier(record.sourceNodeRef, "edge.sourceNodeRef"),
    targetNodeRef: requireIdentifier(record.targetNodeRef, "edge.targetNodeRef"),
    relationType: requireIdentifier(record.relationType, "edge.relationType"),
    inheritancePolicyKey: requireIdentifier(
      record.inheritancePolicyKey,
      "edge.inheritancePolicyKey",
    ),
    status: requireIdentifier(record.status, "edge.status").toLowerCase(),
    revokedAt: record.revokedAt || null,
    validFrom: record.validFrom || null,
    validUntil: record.validUntil || record.expiresAt || null,
    sourceRef: optionalIdentifier(record.sourceRef, "edge.sourceRef"),
    versionRef: optionalIdentifier(record.versionRef, "edge.versionRef"),
  };
}

function normalizeRestriction(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("resource graph restrictions must be objects.");
  }
  const effect = requireIdentifier(record.effect, "restriction.effect").toLowerCase();
  if (effect !== "deny") throw new TypeError("restriction.effect must be deny.");
  const operations = Array.isArray(record.operations) && record.operations.length > 0
    ? [...new Set(record.operations.map((value) => (value === "*"
      ? "*"
      : requireIdentifier(value, "restriction.operations"))))].sort()
    : ["*"];
  const reasonCode = requireString(record.reasonCode, "restriction.reasonCode").toUpperCase();
  if (!REASON_CODE_PATTERN.test(reasonCode)) {
    throw new TypeError("restriction.reasonCode must be a stable uppercase reason code.");
  }
  return {
    restrictionRef: requireIdentifier(record.restrictionRef, "restriction.restrictionRef"),
    nodeRef: requireIdentifier(record.nodeRef, "restriction.nodeRef"),
    effect,
    operations,
    reasonCode,
    status: requireIdentifier(record.status, "restriction.status").toLowerCase(),
    revokedAt: record.revokedAt || null,
    validFrom: record.validFrom || null,
    validUntil: record.validUntil || record.expiresAt || null,
    sourceRef: optionalIdentifier(record.sourceRef, "restriction.sourceRef"),
    versionRef: optionalIdentifier(record.versionRef, "restriction.versionRef"),
  };
}

function restrictionApplies(restriction, operationIntent, now) {
  return recordIsActive(restriction, now)
    && (restriction.operations.includes("*") || restriction.operations.includes(operationIntent));
}

export function evaluateBoundedResourceGraph({
  snapshot,
  tenantRef,
  workspaceRef = null,
  rootNodeRef,
  rootResourceType,
  rootResourceRef,
  relationTypes,
  inheritancePolicyKeys,
  operationIntent,
  maxDepth = RESOURCE_GRAPH_LIMITS.defaultMaxDepth,
  maxNodes = RESOURCE_GRAPH_LIMITS.defaultMaxNodes,
  now = new Date(),
} = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("snapshot must be an object.");
  }
  const normalizedTenantRef = requireIdentifier(tenantRef, "tenantRef");
  const normalizedWorkspaceRef = optionalIdentifier(workspaceRef, "workspaceRef");
  const normalizedRootNodeRef = requireIdentifier(rootNodeRef, "rootNodeRef");
  const normalizedRootResourceType = requireIdentifier(rootResourceType, "rootResourceType");
  const normalizedRootResourceRef = requireIdentifier(rootResourceRef, "rootResourceRef");
  const normalizedOperation = requireIdentifier(operationIntent, "operationIntent");
  const normalizedRelationTypes = normalizeIdentifierSet(
    relationTypes,
    "relationTypes",
    RESOURCE_GRAPH_LIMITS.maxRelationTypes,
  );
  const normalizedPolicyKeys = normalizeIdentifierSet(
    inheritancePolicyKeys,
    "inheritancePolicyKeys",
    RESOURCE_GRAPH_LIMITS.maxInheritancePolicyKeys,
  );
  const normalizedMaxDepth = normalizeBound(
    maxDepth,
    "maxDepth",
    RESOURCE_GRAPH_LIMITS.defaultMaxDepth,
    RESOURCE_GRAPH_LIMITS.absoluteMaxDepth,
    0,
  );
  const normalizedMaxNodes = normalizeBound(
    maxNodes,
    "maxNodes",
    RESOURCE_GRAPH_LIMITS.defaultMaxNodes,
    RESOURCE_GRAPH_LIMITS.absoluteMaxNodes,
  );
  const evaluatedAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedAt.getTime())) throw new TypeError("now must be a valid timestamp.");

  if (snapshot.stale === true) return blocked(["RESOURCE_GRAPH_SNAPSHOT_STALE"]);

  const rawNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const rawEdges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
  const rawRestrictions = Array.isArray(snapshot.restrictions) ? snapshot.restrictions : [];
  if (rawNodes.length > normalizedMaxNodes) {
    return blocked(["RESOURCE_GRAPH_NODE_LIMIT_EXCEEDED"], {
      bounds: { maxDepth: normalizedMaxDepth, maxNodes: normalizedMaxNodes },
    });
  }
  if (rawEdges.length > normalizedMaxNodes * 8) {
    return blocked(["RESOURCE_GRAPH_EDGE_LIMIT_EXCEEDED"]);
  }
  if (rawRestrictions.length > normalizedMaxNodes * 4) {
    return blocked(["RESOURCE_GRAPH_RESTRICTION_LIMIT_EXCEEDED"]);
  }

  const nodeMap = new Map();
  for (const rawNode of rawNodes) {
    const node = normalizeNode(rawNode, normalizedTenantRef);
    if (nodeMap.has(node.nodeRef)) return blocked(["RESOURCE_GRAPH_NODE_REFERENCE_AMBIGUOUS"]);
    if (node.tenantMismatch) return blocked(["RESOURCE_GRAPH_CROSS_TENANT_NODE"]);
    if (
      normalizedWorkspaceRef &&
      node.workspaceRef &&
      node.workspaceRef !== normalizedWorkspaceRef
    ) {
      return blocked(["RESOURCE_GRAPH_CROSS_WORKSPACE_NODE"]);
    }
    nodeMap.set(node.nodeRef, node);
  }

  const rootNode = nodeMap.get(normalizedRootNodeRef);
  if (!rootNode) return blocked(["RESOURCE_GRAPH_ROOT_NOT_FOUND"]);
  if (
    rootNode.resourceType !== normalizedRootResourceType ||
    rootNode.resourceRef !== normalizedRootResourceRef
  ) {
    return blocked(["RESOURCE_GRAPH_ROOT_IDENTITY_MISMATCH"]);
  }
  if (!recordIsActive(rootNode, evaluatedAt)) return blocked(["RESOURCE_GRAPH_ROOT_NOT_ACTIVE"]);

  const edges = rawEdges.map(normalizeEdge);
  const edgeRefs = new Set();
  const adjacency = new Map();
  for (const edge of edges) {
    if (edgeRefs.has(edge.edgeRef)) return blocked(["RESOURCE_GRAPH_EDGE_REFERENCE_AMBIGUOUS"]);
    edgeRefs.add(edge.edgeRef);
    if (!nodeMap.has(edge.sourceNodeRef) || !nodeMap.has(edge.targetNodeRef)) {
      return blocked(["RESOURCE_GRAPH_EDGE_NODE_NOT_FOUND"]);
    }
    if (!normalizedRelationTypes.includes(edge.relationType)) continue;
    if (!adjacency.has(edge.sourceNodeRef)) adjacency.set(edge.sourceNodeRef, []);
    adjacency.get(edge.sourceNodeRef).push(edge);
  }
  for (const list of adjacency.values()) {
    list.sort((left, right) => left.edgeRef.localeCompare(right.edgeRef));
  }

  const restrictions = rawRestrictions.map(normalizeRestriction);
  const restrictionRefs = new Set();
  const activeRestrictionsByNode = new Map();
  for (const restriction of restrictions) {
    if (restrictionRefs.has(restriction.restrictionRef)) {
      return blocked(["RESOURCE_GRAPH_RESTRICTION_REFERENCE_AMBIGUOUS"]);
    }
    restrictionRefs.add(restriction.restrictionRef);
    if (!nodeMap.has(restriction.nodeRef)) {
      return blocked(["RESOURCE_GRAPH_RESTRICTION_NODE_NOT_FOUND"]);
    }
    if (!restrictionApplies(restriction, normalizedOperation, evaluatedAt)) continue;
    if (!activeRestrictionsByNode.has(restriction.nodeRef)) {
      activeRestrictionsByNode.set(restriction.nodeRef, []);
    }
    activeRestrictionsByNode.get(restriction.nodeRef).push(restriction);
  }

  const rootRestrictions = activeRestrictionsByNode.get(normalizedRootNodeRef) || [];
  if (rootRestrictions.length > 0) {
    return blocked([
      "RESOURCE_GRAPH_ROOT_RESTRICTED",
      ...rootRestrictions.map((restriction) => restriction.reasonCode),
    ]);
  }

  const visited = new Set();
  const queue = [{ nodeRef: normalizedRootNodeRef, depth: 0 }];
  const resolvedNodes = [];
  const traversedEdges = [];
  const blockedBranches = [];
  const reasonCodes = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.nodeRef)) continue;
    visited.add(current.nodeRef);
    if (visited.size > normalizedMaxNodes) {
      return blocked(["RESOURCE_GRAPH_TRAVERSAL_NODE_LIMIT_EXCEEDED"]);
    }

    const node = nodeMap.get(current.nodeRef);
    if (!node || !recordIsActive(node, evaluatedAt)) {
      reasonCodes.push("RESOURCE_GRAPH_NODE_NOT_ACTIVE");
      continue;
    }
    resolvedNodes.push({ ...node, depth: current.depth });

    const outgoing = adjacency.get(current.nodeRef) || [];
    for (const edge of outgoing) {
      if (!recordIsActive(edge, evaluatedAt)) {
        reasonCodes.push("RESOURCE_GRAPH_EDGE_NOT_ACTIVE");
        continue;
      }
      if (!normalizedPolicyKeys.includes(edge.inheritancePolicyKey)) {
        reasonCodes.push("RESOURCE_GRAPH_INHERITANCE_POLICY_NOT_ALLOWED");
        continue;
      }
      if (current.depth >= normalizedMaxDepth) {
        reasonCodes.push("RESOURCE_GRAPH_DEPTH_BOUND_REACHED");
        continue;
      }

      const targetNode = nodeMap.get(edge.targetNodeRef);
      if (!targetNode || !recordIsActive(targetNode, evaluatedAt)) {
        reasonCodes.push("RESOURCE_GRAPH_NODE_NOT_ACTIVE");
        continue;
      }

      const branchRestrictions = activeRestrictionsByNode.get(edge.targetNodeRef) || [];
      if (branchRestrictions.length > 0) {
        blockedBranches.push({
          nodeRef: edge.targetNodeRef,
          viaEdgeRef: edge.edgeRef,
          reasonCodes: branchRestrictions.map((restriction) => restriction.reasonCode).sort(),
          restrictionRefs: branchRestrictions.map((restriction) => restriction.restrictionRef).sort(),
        });
        reasonCodes.push("RESOURCE_GRAPH_BRANCH_RESTRICTED");
        continue;
      }

      traversedEdges.push(edge);
      if (!visited.has(edge.targetNodeRef)) {
        queue.push({ nodeRef: edge.targetNodeRef, depth: current.depth + 1 });
      }
    }
  }

  resolvedNodes.sort((left, right) => left.nodeRef.localeCompare(right.nodeRef));
  traversedEdges.sort((left, right) => left.edgeRef.localeCompare(right.edgeRef));
  blockedBranches.sort((left, right) => left.nodeRef.localeCompare(right.nodeRef));

  return deepFreeze({
    status: "resolved",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    rootNodeRef: normalizedRootNodeRef,
    nodes: resolvedNodes,
    edges: traversedEdges,
    blockedBranches,
    bounds: {
      maxDepth: normalizedMaxDepth,
      maxNodes: normalizedMaxNodes,
      relationTypes: normalizedRelationTypes,
      inheritancePolicyKeys: normalizedPolicyKeys,
    },
    sourceEvidence: {
      sourceRef: optionalIdentifier(snapshot.sourceRef, "snapshot.sourceRef"),
      versionRef: optionalIdentifier(snapshot.versionRef, "snapshot.versionRef"),
      evaluatedAt: evaluatedAt.toISOString(),
    },
    authorityGranted: false,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  });
}

export const _testingResourceGraphPolicy = deepFreeze({
  normalizeBound,
  normalizeIdentifierSet,
  recordIsActive,
  restrictionApplies,
});
