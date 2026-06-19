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
    return selectedResult(strategy, selected, selectedEffect, {
      decision: selectedEffect,
      blocked: selectedEffect === "deny",
      code: selectedEffect === "deny" ? "inherited_policy_restriction" : null
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

  if (strategy === "minimum") {
    const numeric = ordered.map(row => Number(row.value)).filter(Number.isFinite);
    if (!numeric.length) {
      return { strategy, decision: "blocked", blocked: true, ambiguous: false, code: "classification_conflict", value: null, sourceIds: [] };
    }
    return selectedResult(strategy, ordered, Math.min(...numeric));
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
