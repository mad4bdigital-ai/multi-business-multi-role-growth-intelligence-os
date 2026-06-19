import { createHash } from "node:crypto";

export const DEFAULT_CONTAINER_RESOLUTION_LIMITS = Object.freeze({
  maxDepth: 16,
  maxPaths: 256,
  maxVisitedContainers: 2048,
  maxTraversedRelationships: 4096,
  maxCandidateBindings: 5000
});

const SECRET_KEY_PATTERN = /(^|_)(secret|password|token|private_key|client_secret|refresh_token|access_token|api_key|credential_payload)(_|$)/i;

function parseStringArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rowsToMap(input, keys) {
  if (input instanceof Map) return input;
  if (!Array.isArray(input)) return new Map(Object.entries(input || {}));
  return new Map(input.map(row => {
    const key = keys.map(name => row?.[name]).find(Boolean);
    return [String(key || ""), row];
  }).filter(([key]) => key));
}

function isActive(row) {
  return String(row?.status || "active").toLowerCase() === "active";
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonicalize(value[key]);
    return out;
  }, {});
}

export function stableSerialize(value) {
  return JSON.stringify(canonicalize(value));
}

export function validateNoSecretMetadata(value) {
  const violations = [];
  const seen = new WeakSet();

  function visit(current, path) {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, item] of Object.entries(current)) {
      const nextPath = `${path}.${key}`;
      if (SECRET_KEY_PATTERN.test(key)) {
        violations.push({ code: "container_secret_field_forbidden", path: nextPath });
      }
      visit(item, nextPath);
    }
  }

  visit(value, "$" );
  return { ok: violations.length === 0, violations };
}

export function validateContainerRelationship({
  relationship,
  relationships = [],
  containers = [],
  containerTypes = [],
  relationshipTypes = []
} = {}) {
  const errors = [];
  const containerMap = rowsToMap(containers, ["container_id", "containerId"]);
  const typeMap = rowsToMap(containerTypes, ["container_type_key", "containerTypeKey"]);
  const relationshipTypeMap = rowsToMap(relationshipTypes, ["relationship_type_key", "relationshipTypeKey"]);

  const fromId = String(relationship?.from_container_id || relationship?.fromContainerId || "");
  const toId = String(relationship?.to_container_id || relationship?.toContainerId || "");
  const relationshipTypeKey = String(relationship?.relationship_type_key || relationship?.relationshipTypeKey || "");
  const fromContainer = containerMap.get(fromId);
  const toContainer = containerMap.get(toId);
  const relationshipType = relationshipTypeMap.get(relationshipTypeKey);

  if (!fromContainer) errors.push({ code: "container_not_found", field: "from_container_id", value: fromId });
  if (!toContainer) errors.push({ code: "container_not_found", field: "to_container_id", value: toId });
  if (fromId && fromId === toId) errors.push({ code: "container_cycle_detected", field: "to_container_id", value: toId });
  if (!relationshipType || !isActive(relationshipType)) {
    errors.push({ code: "container_relationship_not_allowed", field: "relationship_type_key", value: relationshipTypeKey });
  }

  if (fromContainer && toContainer) {
    const relationshipTenant = String(relationship?.tenant_id || relationship?.tenantId || fromContainer.tenant_id || "");
    if (String(fromContainer.tenant_id) !== String(toContainer.tenant_id) || relationshipTenant !== String(fromContainer.tenant_id)) {
      errors.push({ code: "container_cross_tenant_boundary", field: "tenant_id", value: relationshipTenant });
    }

    if (relationshipType?.relationship_class === "containment") {
      const parentType = typeMap.get(String(fromContainer.container_type_key || fromContainer.containerTypeKey || ""));
      const childType = typeMap.get(String(toContainer.container_type_key || toContainer.containerTypeKey || ""));
      if (!parentType || !childType || !isActive(parentType) || !isActive(childType)) {
        errors.push({ code: "container_type_not_registered" });
      } else {
        const childTypeKey = String(childType.container_type_key || childType.containerTypeKey);
        const parentTypeKey = String(parentType.container_type_key || parentType.containerTypeKey);
        const allowedChildren = parseStringArray(parentType.allowed_child_types_json ?? parentType.allowedChildTypes);
        const allowedParents = parseStringArray(childType.allowed_parent_types_json ?? childType.allowedParentTypes);
        if (!allowedChildren.includes("*") && !allowedChildren.includes(childTypeKey)) {
          errors.push({ code: "container_relationship_not_allowed", field: "child_container_type", value: childTypeKey });
        }
        if (!allowedParents.includes("*") && !allowedParents.includes(parentTypeKey)) {
          errors.push({ code: "container_relationship_not_allowed", field: "parent_container_type", value: parentTypeKey });
        }

        const supportsMultiParent = Number(childType.supports_multi_parent ?? childType.supportsMultiParent ?? 1) === 1;
        if (!supportsMultiParent) {
          const ancestryTypes = new Set(
            Array.from(relationshipTypeMap.values())
              .filter(row => isActive(row) && Number(row.contributes_to_ancestry ?? row.contributesToAncestry) === 1)
              .map(row => String(row.relationship_type_key || row.relationshipTypeKey))
          );
          const activeParentCount = relationships.filter(row =>
            isActive(row) &&
            String(row.to_container_id || row.toContainerId) === toId &&
            ancestryTypes.has(String(row.relationship_type_key || row.relationshipTypeKey)) &&
            String(row.relationship_id || row.relationshipId || "") !== String(relationship?.relationship_id || relationship?.relationshipId || "")
          ).length;
          if (activeParentCount > 0) {
            errors.push({ code: "container_multiple_parents_not_allowed", field: "to_container_id", value: toId });
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, fromContainer, toContainer, relationshipType };
}

export function detectContainmentCycle({
  relationships = [],
  proposedRelationship,
  relationshipTypes = [],
  limits = {}
} = {}) {
  const effectiveLimits = { ...DEFAULT_CONTAINER_RESOLUTION_LIMITS, ...(limits || {}) };
  const relationshipTypeMap = rowsToMap(relationshipTypes, ["relationship_type_key", "relationshipTypeKey"]);
  const ancestryTypes = new Set(
    Array.from(relationshipTypeMap.values())
      .filter(row => isActive(row) && Number(row.contributes_to_ancestry ?? row.contributesToAncestry) === 1)
      .map(row => String(row.relationship_type_key || row.relationshipTypeKey))
  );

  const fromId = String(proposedRelationship?.from_container_id || proposedRelationship?.fromContainerId || "");
  const toId = String(proposedRelationship?.to_container_id || proposedRelationship?.toContainerId || "");
  if (!fromId || !toId) return { hasCycle: false, blocked: true, code: "container_not_found", path: [] };
  if (fromId === toId) return { hasCycle: true, blocked: true, code: "container_cycle_detected", path: [fromId, toId] };

  const adjacency = new Map();
  let traversedRelationshipCount = 0;
  for (const row of relationships) {
    if (!isActive(row)) continue;
    const typeKey = String(row.relationship_type_key || row.relationshipTypeKey || "");
    if (!ancestryTypes.has(typeKey)) continue;
    traversedRelationshipCount += 1;
    if (traversedRelationshipCount > effectiveLimits.maxTraversedRelationships) {
      return { hasCycle: false, blocked: true, code: "container_resolution_limit_exceeded", path: [], traversedRelationshipCount };
    }
    const source = String(row.from_container_id || row.fromContainerId || "");
    const target = String(row.to_container_id || row.toContainerId || "");
    if (!adjacency.has(source)) adjacency.set(source, []);
    adjacency.get(source).push(target);
  }
  for (const targets of adjacency.values()) targets.sort();

  const stack = [{ node: toId, path: [toId], depth: 0 }];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current.node)) continue;
    visited.add(current.node);
    if (visited.size > effectiveLimits.maxVisitedContainers) {
      return { hasCycle: false, blocked: true, code: "container_resolution_limit_exceeded", path: current.path, visitedCount: visited.size };
    }
    const targets = adjacency.get(current.node) || [];
    if (current.depth >= effectiveLimits.maxDepth && targets.length) {
      return { hasCycle: false, blocked: true, code: "container_resolution_limit_exceeded", path: current.path, visitedCount: visited.size };
    }
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index];
      const nextPath = [...current.path, target];
      if (target === fromId) {
        return { hasCycle: true, blocked: true, code: "container_cycle_detected", path: [fromId, ...nextPath], visitedCount: visited.size };
      }
      stack.push({ node: target, path: nextPath, depth: current.depth + 1 });
    }
  }

  return { hasCycle: false, blocked: false, code: null, path: [], visitedCount: visited.size, traversedRelationshipCount };
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const depthDelta = Number(left.depth ?? Number.MAX_SAFE_INTEGER) - Number(right.depth ?? Number.MAX_SAFE_INTEGER);
    if (depthDelta) return depthDelta;
    const priorityDelta = Number(right.priority ?? 0) - Number(left.priority ?? 0);
    if (priorityDelta) return priorityDelta;
    return String(left.sourceId || left.binding_id || left.classification_id || "")
      .localeCompare(String(right.sourceId || right.binding_id || right.classification_id || ""));
  });
}

function selectedResult(strategy, candidates, value, extra = {}) {
  return {
    strategy,
    decision: "resolved",
    blocked: false,
    ambiguous: false,
    value,
    sourceIds: candidates.map(row => String(row.sourceId || row.binding_id || row.classification_id || "")).filter(Boolean),
    ...extra
  };
}

export function resolveContainerDimensionCandidates(candidates = [], strategy = "deny_wins") {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { strategy, decision: "empty", blocked: false, ambiguous: false, value: null, sourceIds: [] };
  }
  if (candidates.length > DEFAULT_CONTAINER_RESOLUTION_LIMITS.maxCandidateBindings) {
    return { strategy, decision: "blocked", blocked: true, ambiguous: false, code: "container_resolution_limit_exceeded", value: null, sourceIds: [] };
  }

  const ordered = sortCandidates(candidates);
  if (strategy === "deny_wins") {
    const effectOrder = ["deny", "restrict", "require", "allow", "delegate", "share"];
    const selectedEffect = effectOrder.find(effect => ordered.some(row => String(row.effect || "").toLowerCase() === effect)) || "none";
    const selected = ordered.filter(row => String(row.effect || "").toLowerCase() === selectedEffect);
    const blocked = selectedEffect === "deny" || selectedEffect === "require";
    return selectedResult(strategy, selected, selectedEffect, {
      decision: selectedEffect,
      blocked,
      code:selectedEffect === "deny"
        ? "inherited_policy_restriction"
        : selectedEffect === "require" ? "resource_requirement_unsatisfied" : null
    });
  }

  if (strategy === "union" || strategy === "intersection") {
    const valueSets = ordered.map(row => new Set(Array.isArray(row.value) ? row.value.map(String) : [String(row.value)]));
    let values;
    if (strategy === "union") {
      values = [...new Set(valueSets.flatMap(set => [...set]))].sort();
    } else {
      values = [...valueSets[0]].filter(value => valueSets.slice(1).every(set => set.has(value))).sort();
    }
    return selectedResult(strategy, ordered, values);
  }

  if (strategy === "minimum" || strategy === "maximum") {
    const numeric = ordered.map(row => Number(row.value)).filter(Number.isFinite);
    if (!numeric.length) {
      return { strategy, decision: "blocked", blocked: true, ambiguous: false, code: "classification_conflict", value: null, sourceIds: [] };
    }
    return selectedResult(strategy, ordered, strategy === "minimum" ? Math.min(...numeric) : Math.max(...numeric));
  }

  if (strategy === "nearest_replace" || strategy === "priority_replace") {
    const firstMetric = strategy === "nearest_replace"
      ? Math.min(...ordered.map(row => Number(row.depth ?? Number.MAX_SAFE_INTEGER)))
      : Math.max(...ordered.map(row => Number(row.priority ?? 0)));
    const firstPass = ordered.filter(row => strategy === "nearest_replace"
      ? Number(row.depth ?? Number.MAX_SAFE_INTEGER) === firstMetric
      : Number(row.priority ?? 0) === firstMetric);
    const secondMetric = strategy === "nearest_replace"
      ? Math.max(...firstPass.map(row => Number(row.priority ?? 0)))
      : Math.min(...firstPass.map(row => Number(row.depth ?? Number.MAX_SAFE_INTEGER)));
    const finalists = firstPass.filter(row => strategy === "nearest_replace"
      ? Number(row.priority ?? 0) === secondMetric
      : Number(row.depth ?? Number.MAX_SAFE_INTEGER) === secondMetric);
    const values = new Map(finalists.map(row => [stableSerialize(row.value), row.value]));
    if (values.size > 1) {
      return {
        strategy,
        decision: "ambiguous",
        blocked: true,
        ambiguous: true,
        code: "container_path_ambiguous",
        value: null,
        sourceIds: finalists.map(row => String(row.sourceId || row.binding_id || row.classification_id || "")).filter(Boolean)
      };
    }
    return selectedResult(strategy, finalists, values.values().next().value);
  }

  return { strategy, decision: "blocked", blocked: true, ambiguous: false, code: "container_merge_strategy_unsupported", value: null, sourceIds: [] };
}

export function stableSha256(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function operationPatternMatches(pattern, operation) {
  const normalizedPattern = String(pattern || "").trim().toLowerCase();
  const normalizedOperation = String(operation || "").trim().toLowerCase();
  if (!normalizedPattern || !normalizedOperation || normalizedPattern === "*") return false;
  if (normalizedPattern === normalizedOperation) return true;
  if (!normalizedPattern.endsWith(".*")) return false;
  const prefix = normalizedPattern.slice(0, -1);
  return normalizedOperation.startsWith(prefix) && normalizedOperation.length > prefix.length;
}

export function bindingMatchesDimensionRequest(binding = {}, request = {}) {
  if (String(binding.dimension_key || binding.dimension || "") !== String(request.dimension || request.dimension_key || "")) return false;
  if (String(binding.resource_type || "") !== String(request.resourceType || request.resource_type || "")) return false;
  if (String(binding.resource_ref || "") !== String(request.resourceRef || request.resource_ref || "")) return false;
  const patterns = parseStringArray(binding.operation_patterns_json ?? binding.operations);
  if (!patterns.length) return true;
  return patterns.some(pattern => operationPatternMatches(pattern, request.operation));
}

export function enumerateContainerPaths({ targetContainerId, relationships = [], relationshipTypes = [], limits = {} } = {}) {
  const effectiveLimits = { ...DEFAULT_CONTAINER_RESOLUTION_LIMITS, ...(limits || {}) };
  const relationshipTypeMap = rowsToMap(relationshipTypes, ["relationship_type_key", "relationshipTypeKey"]);
  const ancestryTypes = new Set(
    Array.from(relationshipTypeMap.values())
      .filter(row => isActive(row) && Number(row.contributes_to_ancestry ?? row.contributesToAncestry) === 1)
      .map(row => String(row.relationship_type_key || row.relationshipTypeKey))
  );
  const parentEdges = new Map();
  let traversedRelationshipCount = 0;
  for (const row of relationships) {
    if (!isActive(row)) continue;
    const typeKey = String(row.relationship_type_key || row.relationshipTypeKey || "");
    if (!ancestryTypes.has(typeKey)) continue;
    traversedRelationshipCount += 1;
    if (traversedRelationshipCount > effectiveLimits.maxTraversedRelationships) {
      return { ok: false, blocked: true, code: "container_resolution_limit_exceeded", paths: [], traversedRelationshipCount };
    }
    const childId = String(row.to_container_id || row.toContainerId || "");
    const parentId = String(row.from_container_id || row.fromContainerId || "");
    if (!parentEdges.has(childId)) parentEdges.set(childId, []);
    parentEdges.get(childId).push({
      relationshipId: String(row.relationship_id || row.relationshipId || ""),
      parentId,
      childId,
      priority: Number(row.priority || 0)
    });
  }
  for (const edges of parentEdges.values()) {
    edges.sort((left, right) => left.parentId.localeCompare(right.parentId) || left.relationshipId.localeCompare(right.relationshipId));
  }

  const target = String(targetContainerId || "");
  if (!target) return { ok: false, blocked: true, code: "container_not_found", paths: [] };
  const stack = [{ nodeId: target, nodePath: [target], edgePath: [], depth: 0 }];
  const paths = [];
  const visitedContainers = new Set();
  while (stack.length) {
    const current = stack.pop();
    current.nodePath.forEach(id => visitedContainers.add(id));
    if (visitedContainers.size > effectiveLimits.maxVisitedContainers) {
      return { ok: false, blocked: true, code: "container_resolution_limit_exceeded", paths: [], visitedCount: visitedContainers.size };
    }
    const parents = parentEdges.get(current.nodeId) || [];
    if (!parents.length) {
      paths.push({
        rootContainerId: current.nodeId,
        targetContainerId: target,
        containerIds: [...current.nodePath].reverse(),
        relationshipIds: [...current.edgePath].reverse(),
        depth: current.depth
      });
      if (paths.length > effectiveLimits.maxPaths) {
        return { ok: false, blocked: true, code: "container_resolution_limit_exceeded", paths: [], pathCount: paths.length };
      }
      continue;
    }
    if (current.depth >= effectiveLimits.maxDepth) {
      return { ok: false, blocked: true, code: "container_resolution_limit_exceeded", paths: [], depth: current.depth };
    }
    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const edge = parents[index];
      if (current.nodePath.includes(edge.parentId)) {
        return {
          ok: false,
          blocked: true,
          code: "container_cycle_detected",
          paths: [],
          cyclePath: [edge.parentId, ...current.nodePath.slice(0, current.nodePath.indexOf(edge.parentId) + 1).reverse()]
        };
      }
      stack.push({
        nodeId: edge.parentId,
        nodePath: [...current.nodePath, edge.parentId],
        edgePath: [...current.edgePath, edge.relationshipId],
        depth: current.depth + 1
      });
    }
  }

  paths.sort((left, right) =>
    left.rootContainerId.localeCompare(right.rootContainerId) ||
    stableSerialize(left.relationshipIds).localeCompare(stableSerialize(right.relationshipIds))
  );
  return {
    ok: true,
    blocked: false,
    code: null,
    paths: paths.map(path => ({ ...path, pathHash: stableSha256(path) })),
    pathCount: paths.length,
    visitedCount: visitedContainers.size,
    traversedRelationshipCount
  };
}

export function buildContainerClosureRows({ tenantId, containers = [], relationships = [], relationshipTypes = [], authorityEpoch = 0, limits = {} } = {}) {
  const rowsByKey = new Map();
  for (const container of containers) {
    if (!isActive(container) || String(container.tenant_id || "") !== String(tenantId || "")) continue;
    const descendantId = String(container.container_id || container.containerId || "");
    const result = enumerateContainerPaths({ targetContainerId: descendantId, relationships, relationshipTypes, limits });
    if (!result.ok) return { ...result, rows: [] };
    const selfKey = `${descendantId}|${descendantId}`;
    rowsByKey.set(selfKey, {
      tenant_id: tenantId,
      ancestor_container_id: descendantId,
      descendant_container_id: descendantId,
      shortest_depth: 0,
      longest_depth: 0,
      path_count: 1,
      path_hash: stableSha256({ ancestor: descendantId, descendant: descendantId, paths: [[]] }),
      authority_epoch: authorityEpoch
    });
    const evidenceByAncestor = new Map();
    for (const path of result.paths) {
      path.containerIds.forEach((ancestorId, index) => {
        if (!evidenceByAncestor.has(ancestorId)) evidenceByAncestor.set(ancestorId, []);
        evidenceByAncestor.get(ancestorId).push({
          depth: path.containerIds.length - 1 - index,
          relationshipIds: path.relationshipIds.slice(index)
        });
      });
    }
    for (const [ancestorId, evidence] of evidenceByAncestor.entries()) {
      if (ancestorId === descendantId) continue;
      const depths = evidence.map(item => item.depth);
      const sortedPaths = evidence.map(item => item.relationshipIds).sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
      rowsByKey.set(`${ancestorId}|${descendantId}`, {
        tenant_id: tenantId,
        ancestor_container_id: ancestorId,
        descendant_container_id: descendantId,
        shortest_depth: Math.min(...depths),
        longest_depth: Math.max(...depths),
        path_count: evidence.length,
        path_hash: stableSha256({ ancestor: ancestorId, descendant: descendantId, paths: sortedPaths }),
        authority_epoch: authorityEpoch
      });
    }
  }
  return { ok: true, blocked: false, code: null, rows: [...rowsByKey.values()] };
}

export function validateDelegationAgainstResolution({ delegation = {}, delegatorResolution = {} } = {}) {
  if (!delegatorResolution || delegatorResolution.decision !== "allow") {
    return { ok: false, code: "delegation_exceeds_delegator_authority" };
  }
  const request = {
    dimension: delegation.dimension_key || delegation.dimension,
    resourceType: delegation.resource_type || delegation.resourceType,
    resourceRef: delegation.resource_ref || delegation.resourceRef,
    operation: delegation.operation || parseStringArray(delegation.operation_patterns_json)[0]
  };
  if (!request.operation || request.operation === "*" || request.operation.endsWith(".*")) {
    return { ok: false, code: "delegation_exceeds_delegator_authority" };
  }
  const grants = Array.isArray(delegatorResolution.effectiveBindings) ? delegatorResolution.effectiveBindings : [];
  const matching = grants.some(binding =>
    ["allow", "delegate"].includes(String(binding.effect || "").toLowerCase()) &&
    bindingMatchesDimensionRequest(binding, request)
  );
  return matching
    ? { ok: true, code: null }
    : { ok: false, code: "delegation_exceeds_delegator_authority" };
}

export const CRITICAL_OVERRIDE_RISK_CLASSES = Object.freeze(new Set([
  "critical",
  "destructive",
  "credential_touching",
  "deployment_affecting"
]));

export const DUAL_APPROVAL_OVERRIDE_RISK_CLASSES = Object.freeze(new Set([
  "destructive",
  "credential_touching",
  "deployment_affecting"
]));

export function resolveOverridePolicy(riskClass = "standard", requestedTtlMinutes = null) {
  const normalizedRisk = String(riskClass || "standard").trim().toLowerCase();
  const critical = CRITICAL_OVERRIDE_RISK_CLASSES.has(normalizedRisk);
  const dualApprovalRequired = DUAL_APPROVAL_OVERRIDE_RISK_CLASSES.has(normalizedRisk);
  const selfApprovalAllowed = new Set(["read_only","standard","high"]).has(normalizedRisk);
  const maximumTtlMinutes = critical ? 15 : 60;
  const requested = Number(requestedTtlMinutes || maximumTtlMinutes);
  const ttlMinutes = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), maximumTtlMinutes) : maximumTtlMinutes;
  return {
    riskClass: normalizedRisk,
    critical,
    dualApprovalRequired,
    maximumTtlMinutes,
    ttlMinutes,
    requiredApprovalCount:dualApprovalRequired ? 2 : 1,
    selfApprovalAllowed
  };
}

export function resolveRoleTemplateComposition({ rootRoleTemplateKey, roleTemplates = [], limits = {} } = {}) {
  const effectiveLimits = { ...DEFAULT_CONTAINER_RESOLUTION_LIMITS, ...(limits || {}) };
  const templateMap = rowsToMap(roleTemplates, ["role_template_key", "roleTemplateKey"]);
  const rootKey = String(rootRoleTemplateKey || "");
  if (!rootKey || !templateMap.has(rootKey) || !isActive(templateMap.get(rootKey))) {
    return { ok:false,blocked:true,code:"role_template_not_registered",templateKeys:[] };
  }
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(key, depth, path) {
    if (depth > effectiveLimits.maxDepth || visited.size > effectiveLimits.maxVisitedContainers) {
      return { ok:false,blocked:true,code:"container_resolution_limit_exceeded",path };
    }
    if (visiting.has(key)) return { ok:false,blocked:true,code:"role_template_cycle_detected",path:[...path,key] };
    if (visited.has(key)) return null;
    const template = templateMap.get(key);
    if (!template || !isActive(template)) return { ok:false,blocked:true,code:"role_template_not_registered",path:[...path,key] };
    visiting.add(key);
    const children = parseStringArray(template.composition_json ?? template.composition).sort();
    for (const child of children) {
      const failure = visit(child,depth+1,[...path,key]);
      if (failure) return failure;
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(key);
    return null;
  }

  const failure = visit(rootKey,0,[]);
  if (failure) return { ...failure,templateKeys:[] };
  return { ok:true,blocked:false,code:null,templateKeys:ordered };
}

export function buildContainerResolutionCacheKey({ tenantId, principal, targetContainerId, dimensionRequests, authorityEpoch, resolverVersion = "container-authority-v1" } = {}) {
  return stableSha256({
    tenantId: String(tenantId || ""),
    principal: { type: String(principal?.type || ""), id: String(principal?.id || "") },
    targetContainerId: String(targetContainerId || ""),
    dimensionRequests: Array.isArray(dimensionRequests) ? dimensionRequests : [],
    authorityEpoch: Number(authorityEpoch || 0),
    resolverVersion
  });
}
