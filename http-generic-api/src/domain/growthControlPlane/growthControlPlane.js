import { createHash } from "node:crypto";

export const GROWTH_CONTROL_SCOPE_TYPES = Object.freeze([
  "platform", "activity", "tenant", "workspace", "brand", "profile",
  "workflow", "workflow_node", "plan", "execution"
]);

export const GROWTH_CONTROL_MERGE_OPERATORS = Object.freeze([
  "priority_replace", "deny_wins", "strict_intersection", "minimum", "maximum",
  "guarded_union", "append_unique", "block_on_ambiguity"
]);

const SCOPE_RANK = Object.freeze(Object.fromEntries(GROWTH_CONTROL_SCOPE_TYPES.map((key, index) => [key, index * 10])));
const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{2,127}$/;
const SECRET_KEY = /(^|_)(secret|password|token|private_key|client_secret|refresh_token|access_token|api_key|credential_payload)(_|$)/i;
const SCHEMA_KEYS = new Set([
  "$schema", "$id", "title", "description", "type", "properties", "required",
  "additionalProperties", "enum", "const", "items", "minItems", "maxItems",
  "uniqueItems", "minLength", "maxLength", "minimum", "maximum", "pattern", "format",
  "examples", "default"
]);

export class GrowthControlPlaneError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = "GrowthControlPlaneError";
    this.code = code;
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }
}

function clean(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
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

export function stableSha256(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function requireCanonicalKey(value, field = "key") {
  const normalized = clean(value);
  if (!normalized || !CANONICAL_KEY.test(normalized)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_CANONICAL_KEY_INVALID",
      `${field} must be a canonical lowercase key.`,
      422,
      [{ field, issue: "invalid_canonical_key" }]
    );
  }
  return normalized;
}

export function assertNoSecretFields(value, path = "$") {
  const violations = [];
  const seen = new WeakSet();
  function visit(current, currentPath) {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      const nextPath = `${currentPath}.${key}`;
      if (SECRET_KEY.test(key)) violations.push({ field: nextPath, issue: "secret_field_forbidden" });
      visit(child, nextPath);
    }
  }
  visit(value, path);
  if (violations.length) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN",
      "Control-plane documents cannot contain credential or secret fields.",
      422,
      violations
    );
  }
  return true;
}

function requireScopeField(value, field, scopeType) {
  const normalized = clean(value);
  if (!normalized) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_SCOPE_FIELD_REQUIRED",
      `${field} is required for ${scopeType} scope.`,
      422,
      [{ field, issue: "required" }]
    );
  }
  return normalized;
}

export function normalizeGrowthControlScope(input = {}) {
  const scopeType = clean(input.scopeType ?? input.scope_type);
  if (!GROWTH_CONTROL_SCOPE_TYPES.includes(scopeType)) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_SCOPE_INVALID", "Unsupported configuration scope.", 422);
  }
  const scope = {
    scopeType,
    tenantId: clean(input.tenantId ?? input.tenant_id),
    workspaceId: clean(input.workspaceId ?? input.workspace_id),
    brandKey: clean(input.brandKey ?? input.brand_key),
    activityTypeKey: clean(input.activityTypeKey ?? input.activity_type_key),
    activityBindingId: clean(input.activityBindingId ?? input.activity_binding_id),
    profileKey: clean(input.profileKey ?? input.profile_key),
    workflowKey: clean(input.workflowKey ?? input.workflow_key),
    workflowVersion: input.workflowVersion ?? input.workflow_version ?? null,
    workflowNodeId: clean(input.workflowNodeId ?? input.workflow_node_id),
    planId: clean(input.planId ?? input.plan_id),
    executionId: clean(input.executionId ?? input.execution_id)
  };

  if (["activity"].includes(scopeType)) requireScopeField(scope.activityTypeKey, "activityTypeKey", scopeType);
  if (["tenant","workspace","brand","profile","workflow","workflow_node","plan","execution"].includes(scopeType)) {
    requireScopeField(scope.tenantId, "tenantId", scopeType);
  }
  if (["workspace","brand","profile","workflow","workflow_node","plan","execution"].includes(scopeType)) {
    requireScopeField(scope.workspaceId, "workspaceId", scopeType);
  }
  if (["brand","profile","workflow","workflow_node","plan","execution"].includes(scopeType)) {
    requireScopeField(scope.brandKey, "brandKey", scopeType);
  }
  if (scopeType === "profile") requireScopeField(scope.profileKey, "profileKey", scopeType);
  if (["workflow","workflow_node"].includes(scopeType)) requireScopeField(scope.workflowKey, "workflowKey", scopeType);
  if (scopeType === "workflow_node") requireScopeField(scope.workflowNodeId, "workflowNodeId", scopeType);
  if (scopeType === "plan") requireScopeField(scope.planId, "planId", scopeType);
  if (scopeType === "execution") requireScopeField(scope.executionId, "executionId", scopeType);

  const scopeKeyParts = {
    platform: ["platform"],
    activity: ["activity", scope.activityTypeKey],
    tenant: ["tenant", scope.tenantId],
    workspace: ["tenant", scope.tenantId, "workspace", scope.workspaceId],
    brand: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey],
    profile: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey, "profile", scope.profileKey],
    workflow: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey, "workflow", scope.workflowKey, String(scope.workflowVersion || "active")],
    workflow_node: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey, "workflow", scope.workflowKey, String(scope.workflowVersion || "active"), "node", scope.workflowNodeId],
    plan: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey, "plan", scope.planId],
    execution: ["tenant", scope.tenantId, "workspace", scope.workspaceId, "brand", scope.brandKey, "execution", scope.executionId]
  };
  return Object.freeze({ ...scope, scopeKey: scopeKeyParts[scopeType].join(":"), rank: SCOPE_RANK[scopeType] });
}

export function buildGrowthControlScopeHierarchy(context = {}) {
  const scopes = [normalizeGrowthControlScope({ scopeType: "platform" })];
  if (context.activityTypeKey) scopes.push(normalizeGrowthControlScope({ scopeType: "activity", activityTypeKey: context.activityTypeKey }));
  if (context.tenantId) scopes.push(normalizeGrowthControlScope({ scopeType: "tenant", tenantId: context.tenantId }));
  if (context.tenantId && context.workspaceId) scopes.push(normalizeGrowthControlScope({ scopeType: "workspace", tenantId: context.tenantId, workspaceId: context.workspaceId }));
  if (context.tenantId && context.workspaceId && context.brandKey) scopes.push(normalizeGrowthControlScope({ scopeType: "brand", tenantId: context.tenantId, workspaceId: context.workspaceId, brandKey: context.brandKey }));
  if (context.profileKey) scopes.push(normalizeGrowthControlScope({ scopeType: "profile", ...context }));
  if (context.workflowKey) scopes.push(normalizeGrowthControlScope({ scopeType: "workflow", ...context }));
  if (context.workflowKey && context.workflowNodeId) scopes.push(normalizeGrowthControlScope({ scopeType: "workflow_node", ...context }));
  if (context.planId) scopes.push(normalizeGrowthControlScope({ scopeType: "plan", ...context }));
  if (context.executionId) scopes.push(normalizeGrowthControlScope({ scopeType: "execution", ...context }));
  return Object.freeze(scopes.sort((a, b) => a.rank - b.rank));
}

export function validateSchemaDefinition(schema, path = "$") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_SCHEMA_INVALID", "Configuration schema must be an object.", 422);
  }
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS.has(key)) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_SCHEMA_KEYWORD_UNSUPPORTED",
        `Unsupported schema keyword: ${key}.`,
        422,
        [{ field: `${path}.${key}`, issue: "unsupported_schema_keyword" }]
      );
    }
  }
  if (schema.properties) {
    if (typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
      throw new GrowthControlPlaneError("GROWTH_CONTROL_SCHEMA_INVALID", "properties must be an object.", 422);
    }
    for (const [key, child] of Object.entries(schema.properties)) validateSchemaDefinition(child, `${path}.properties.${key}`);
  }
  if (schema.items) validateSchemaDefinition(schema.items, `${path}.items`);
  return true;
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function validateValueAgainstSchema(value, schema, path = "$") {
  const issues = [];
  const allowedTypes = Array.isArray(schema?.type) ? schema.type : schema?.type ? [schema.type] : [];
  if (allowedTypes.length && !allowedTypes.some((type) => typeMatches(value, type))) {
    return [{ field: path, issue: "type_mismatch", expected: allowedTypes }];
  }
  if (schema?.enum && !schema.enum.some((entry) => stableSerialize(entry) === stableSerialize(value))) {
    issues.push({ field: path, issue: "enum_mismatch" });
  }
  if (Object.hasOwn(schema || {}, "const") && stableSerialize(schema.const) !== stableSerialize(value)) {
    issues.push({ field: path, issue: "const_mismatch" });
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) issues.push({ field: path, issue: "min_length" });
    if (schema.maxLength != null && value.length > schema.maxLength) issues.push({ field: path, issue: "max_length" });
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) issues.push({ field: path, issue: "pattern_mismatch" });
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) issues.push({ field: path, issue: "minimum" });
    if (schema.maximum != null && value > schema.maximum) issues.push({ field: path, issue: "maximum" });
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) issues.push({ field: path, issue: "min_items" });
    if (schema.maxItems != null && value.length > schema.maxItems) issues.push({ field: path, issue: "max_items" });
    if (schema.uniqueItems && new Set(value.map(stableSerialize)).size !== value.length) issues.push({ field: path, issue: "unique_items" });
    if (schema.items) value.forEach((item, index) => issues.push(...validateValueAgainstSchema(item, schema.items, `${path}[${index}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) issues.push({ field: `${path}.${required}`, issue: "required" });
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false) issues.push({ field: `${path}.${key}`, issue: "unsupported" });
      } else {
        issues.push(...validateValueAgainstSchema(child, properties[key], `${path}.${key}`));
      }
    }
  }
  return issues;
}

function uniqueSorted(values) {
  return [...new Map(values.map((value) => [stableSerialize(value), value])).values()]
    .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
}

function denyValue(value) {
  return value === false || value === "deny" || value === "disabled" || value === "blocked";
}

export function mergeConfigurationCandidates(candidates, operator) {
  if (!GROWTH_CONTROL_MERGE_OPERATORS.includes(operator)) {
    return { blocked: true, code: "GROWTH_CONTROL_MERGE_OPERATOR_UNSUPPORTED", value: null, selected: [], rejected: candidates };
  }
  const ordered = [...candidates].sort((a, b) => b.rank - a.rank || b.versionNumber - a.versionNumber || a.sourceId.localeCompare(b.sourceId));
  if (!ordered.length) return { blocked: false, value: undefined, selected: [], rejected: [] };
  if (operator === "deny_wins") {
    const denied = ordered.filter((entry) => denyValue(entry.value));
    const selected = denied.length ? denied : [ordered[0]];
    return { blocked: false, value: selected[0].value, selected, rejected: ordered.filter((entry) => !selected.includes(entry)) };
  }
  if (operator === "minimum" || operator === "maximum") {
    const numeric = ordered.filter((entry) => Number.isFinite(Number(entry.value)));
    if (!numeric.length) return { blocked: true, code: "GROWTH_CONTROL_MERGE_TYPE_CONFLICT", value: null, selected: [], rejected: ordered };
    const target = operator === "minimum" ? Math.min(...numeric.map((entry) => Number(entry.value))) : Math.max(...numeric.map((entry) => Number(entry.value)));
    const selected = numeric.filter((entry) => Number(entry.value) === target);
    return { blocked: false, value: target, selected, rejected: ordered.filter((entry) => !selected.includes(entry)) };
  }
  if (["strict_intersection","guarded_union","append_unique"].includes(operator)) {
    if (ordered.some((entry) => !Array.isArray(entry.value))) return { blocked: true, code: "GROWTH_CONTROL_MERGE_TYPE_CONFLICT", value: null, selected: [], rejected: ordered };
    let value;
    if (operator === "strict_intersection") {
      value = uniqueSorted(ordered[0].value).filter((item) => ordered.slice(1).every((entry) => entry.value.some((candidate) => stableSerialize(candidate) === stableSerialize(item))));
    } else {
      value = uniqueSorted(ordered.flatMap((entry) => entry.value));
    }
    return { blocked: false, value, selected: ordered, rejected: [] };
  }
  const topRank = ordered[0].rank;
  const finalists = ordered.filter((entry) => entry.rank === topRank);
  const distinct = new Map(finalists.map((entry) => [stableSerialize(entry.value), entry.value]));
  if (distinct.size > 1) {
    return { blocked: true, code: "GROWTH_CONTROL_CONFIG_CONFLICT", value: null, selected: [], rejected: ordered };
  }
  return { blocked: false, value: finalists[0].value, selected: finalists, rejected: ordered.filter((entry) => !finalists.includes(entry)) };
}

export function resolveEffectiveConfiguration({ definition, versions = [], scopeHierarchy = [] } = {}) {
  const configKey = requireCanonicalKey(definition?.configKey ?? definition?.config_key, "configKey");
  const schema = definition.schema ?? definition.schema_json;
  const defaults = definition.defaultValues ?? definition.default_values ?? {};
  const mergeProfile = definition.mergeProfile ?? definition.merge_profile ?? {};
  assertNoSecretFields({ defaults, mergeProfile });
  validateSchemaDefinition(schema);
  const scopeRank = new Map(scopeHierarchy.map((scope) => [scope.scopeKey, scope.rank]));
  const fields = new Map();
  for (const [key, value] of Object.entries(defaults || {})) {
    fields.set(key, [{ value, rank: -1, versionNumber: 0, sourceId: `${configKey}:default`, scopeKey: "default", revision: Number(definition.revision || 0) }]);
  }
  for (const version of versions) {
    const rank = scopeRank.get(version.scopeKey ?? version.scope_key);
    if (rank == null) continue;
    for (const [key, value] of Object.entries(version.values || version.values_json || {})) {
      if (!fields.has(key)) fields.set(key, []);
      fields.get(key).push({
        value, rank, versionNumber: Number(version.versionNumber ?? version.version_number ?? 0),
        sourceId: String(version.configVersionId ?? version.config_version_id),
        scopeKey: String(version.scopeKey ?? version.scope_key),
        revision: Number(version.versionRevision ?? version.version_revision ?? 0)
      });
    }
  }

  const values = {};
  const lineage = {};
  const conflicts = [];
  const revisionVector = { definition: Number(definition.revision || 0), versions: {} };
  for (const [field, candidates] of [...fields.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const operator = mergeProfile[field] || "priority_replace";
    const merged = mergeConfigurationCandidates(candidates, operator);
    lineage[field] = {
      operator,
      selected: merged.selected.map((entry) => ({ sourceId: entry.sourceId, scopeKey: entry.scopeKey, revision: entry.revision })),
      rejected: merged.rejected.map((entry) => ({ sourceId: entry.sourceId, scopeKey: entry.scopeKey, revision: entry.revision }))
    };
    for (const candidate of candidates) {
      if (candidate.sourceId.endsWith(":default")) continue;
      revisionVector.versions[candidate.sourceId] = candidate.revision;
    }
    if (merged.blocked) conflicts.push({ field, code: merged.code, sourceIds: candidates.map((entry) => entry.sourceId) });
    else if (merged.value !== undefined) values[field] = merged.value;
  }
  const schemaIssues = validateValueAgainstSchema(values, schema);
  if (schemaIssues.length) conflicts.push({ field: "$", code: "GROWTH_CONTROL_EFFECTIVE_SCHEMA_INVALID", issues: schemaIssues });
  const resolved = { configKey, values, lineage, revisionVector, conflicts };
  return Object.freeze({ ...resolved, blocked: conflicts.length > 0, sha256: stableSha256(resolved), secretsIncluded: false });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function activityPackCanonicalKey(value, field, details) {
  const normalized = clean(value);
  if (!normalized || !CANONICAL_KEY.test(normalized)) {
    details.push({ field, issue: "invalid_canonical_key" });
    return null;
  }
  return normalized;
}

function activityPackEntryKey(entry, aliases, field, details) {
  if (typeof entry === "string") return activityPackCanonicalKey(entry, field, details);
  if (!isPlainObject(entry)) {
    details.push({ field, issue: "must_be_string_or_object" });
    return null;
  }
  const value = aliases.map((alias) => entry[alias]).find((candidate) => candidate != null);
  return activityPackCanonicalKey(value, field, details);
}

function activityPackKeySet(entries, field, aliases, details) {
  const keys = new Set();
  const items = [];
  if (!Array.isArray(entries)) return { keys, items };
  entries.forEach((entry, index) => {
    const itemField = `${field}[${index}]`;
    const key = activityPackEntryKey(entry, aliases, itemField, details);
    if (!key) return;
    if (keys.has(key)) details.push({ field: itemField, issue: "duplicate_key", key });
    keys.add(key);
    items.push({ entry, index, key });
  });
  return { keys, items };
}

function activityPackReferenceList(value, field, known, details, issue) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    details.push({ field, issue: "must_be_array" });
    return [];
  }
  const seen = new Set();
  const normalized = [];
  value.forEach((entry, index) => {
    const key = activityPackCanonicalKey(entry, `${field}[${index}]`, details);
    if (!key) return;
    if (seen.has(key)) details.push({ field: `${field}[${index}]`, issue: "duplicate_reference", key });
    seen.add(key);
    normalized.push(key);
    if (known && !known.has(key)) details.push({ field: `${field}[${index}]`, issue, key });
  });
  return normalized;
}

function activityPackWorkflowHasCycle(nodeDependencies) {
  const state = new Map();
  function visit(nodeId) {
    const current = state.get(nodeId) || 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(nodeId, 1);
    for (const dependency of nodeDependencies.get(nodeId) || []) {
      if (nodeDependencies.has(dependency) && visit(dependency)) return true;
    }
    state.set(nodeId, 2);
    return false;
  }
  return [...nodeDependencies.keys()].some(visit);
}

function collectForbiddenActivityPackPointers(value, path, details, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenActivityPackPointers(entry, `${path}[${index}]`, details, seen));
    return;
  }
  const forbidden = new Set(["file_path", "file_paths", "drive_id", "drive_ids", "prompt_body", "prompt_bodies"]);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const nextPath = `${path}.${key}`;
    if (forbidden.has(normalizedKey)) details.push({ field: nextPath, issue: "inline_pointer_forbidden" });
    collectForbiddenActivityPackPointers(child, nextPath, details, seen);
  }
}

function validateActivityPackWorkflow(workflow, index, capabilityKeys, details) {
  if (!isPlainObject(workflow)) return;
  const field = `workflows[${index}]`;
  if (workflow.version != null && (!Number.isInteger(Number(workflow.version)) || Number(workflow.version) < 1)) {
    details.push({ field: `${field}.version`, issue: "must_be_positive_integer" });
  }
  if (!Array.isArray(workflow.nodes)) {
    details.push({ field: `${field}.nodes`, issue: "must_be_array" });
    return;
  }
  const nodeIds = new Set();
  const nodeDependencies = new Map();
  workflow.nodes.forEach((node, nodeIndex) => {
    const nodeField = `${field}.nodes[${nodeIndex}]`;
    if (!isPlainObject(node)) {
      details.push({ field: nodeField, issue: "must_be_object" });
      return;
    }
    const nodeId = activityPackCanonicalKey(node.id, `${nodeField}.id`, details);
    if (!nodeId) return;
    if (nodeIds.has(nodeId)) details.push({ field: `${nodeField}.id`, issue: "duplicate_node_id", key: nodeId });
    nodeIds.add(nodeId);
    const capabilityKey = activityPackCanonicalKey(node.capability ?? node.capabilityKey ?? node.capability_key, `${nodeField}.capability`, details);
    if (capabilityKey && !capabilityKeys.has(capabilityKey)) {
      details.push({ field: `${nodeField}.capability`, issue: "unknown_capability_reference", key: capabilityKey });
    }
    const dependencies = activityPackReferenceList(node.dependsOn ?? node.depends_on ?? [], `${nodeField}.dependsOn`, null, details, "unknown_node_reference");
    nodeDependencies.set(nodeId, dependencies);
  });
  for (const [nodeId, dependencies] of nodeDependencies.entries()) {
    dependencies.forEach((dependency) => {
      if (!nodeIds.has(dependency)) details.push({ field: `${field}.nodes.${nodeId}.dependsOn`, issue: "unknown_node_reference", key: dependency });
      if (dependency === nodeId) details.push({ field: `${field}.nodes.${nodeId}.dependsOn`, issue: "self_dependency", key: dependency });
    });
  }
  if (activityPackWorkflowHasCycle(nodeDependencies)) details.push({ field: `${field}.nodes`, issue: "workflow_cycle" });
}

function validateActivityPackCompatibilityEntries(items, field, capabilityKeys, workflowKeys, details) {
  items.forEach(({ entry, index }) => {
    if (!isPlainObject(entry)) return;
    const itemField = `${field}[${index}]`;
    activityPackReferenceList(entry.capabilities ?? entry.capabilityKeys ?? entry.capability_keys, `${itemField}.capabilities`, capabilityKeys, details, "unknown_capability_reference");
    activityPackReferenceList(entry.workflows ?? entry.workflowKeys ?? entry.workflow_keys, `${itemField}.workflows`, workflowKeys, details, "unknown_workflow_reference");
  });
}

export function validateActivityPackManifest(manifest = {}) {
  assertNoSecretFields(manifest);
  const required = ["entitySchemas","knowledgeProfile","kpiTaxonomy","capabilities","workflows","policies","providerCompatibility","tests"];
  const details = required.filter((key) => !Object.hasOwn(manifest, key)).map((field) => ({ field, issue: "required" }));
  for (const key of ["kpiTaxonomy","capabilities","workflows","policies","providerCompatibility"]) {
    if (Object.hasOwn(manifest, key) && !Array.isArray(manifest[key])) details.push({ field: key, issue: "must_be_array" });
  }
  if (!isPlainObject(manifest.entitySchemas)) {
    details.push({ field: "entitySchemas", issue: "must_be_object" });
  } else {
    for (const [entityKey, entitySchema] of Object.entries(manifest.entitySchemas)) {
      activityPackCanonicalKey(entityKey, `entitySchemas.${entityKey}`, details);
      try {
        validateSchemaDefinition(entitySchema, `$.entitySchemas.${entityKey}`);
      } catch (error) {
        const schemaDetails = Array.isArray(error?.details) && error.details.length
          ? error.details
          : [{ field: `entitySchemas.${entityKey}`, issue: "invalid_schema" }];
        details.push(...schemaDetails);
      }
    }
  }
  if (!isPlainObject(manifest.knowledgeProfile)) {
    details.push({ field: "knowledgeProfile", issue: "must_be_object" });
  } else {
    activityPackCanonicalKey(
      manifest.knowledgeProfile.pointerKey ?? manifest.knowledgeProfile.pointer_key,
      "knowledgeProfile.pointerKey",
      details
    );
  }
  if (!isPlainObject(manifest.tests)) {
    details.push({ field: "tests", issue: "must_be_object" });
  } else {
    activityPackReferenceList(manifest.tests.fixtures, "tests.fixtures", null, details, "unknown_fixture_reference");
  }

  if (manifest.identity != null && !isPlainObject(manifest.identity)) details.push({ field: "identity", issue: "must_be_object" });
  if (isPlainObject(manifest.identity)) {
    activityPackCanonicalKey(manifest.identity.activityPackKey ?? manifest.identity.activity_pack_key, "identity.activityPackKey", details);
    const identityVersion = manifest.identity.version;
    if (identityVersion != null && (!Number.isInteger(Number(identityVersion)) || Number(identityVersion) < 1)) {
      details.push({ field: "identity.version", issue: "must_be_positive_integer" });
    }
  }

  const kpis = activityPackKeySet(manifest.kpiTaxonomy, "kpiTaxonomy", ["kpiKey", "kpi_key"], details);
  const capabilities = activityPackKeySet(manifest.capabilities, "capabilities", ["capabilityKey", "capability_key"], details);
  const workflows = activityPackKeySet(manifest.workflows, "workflows", ["workflowKey", "workflow_key"], details);
  const policies = activityPackKeySet(manifest.policies, "policies", ["policyKey", "policy_key"], details);
  const providers = activityPackKeySet(manifest.providerCompatibility, "providerCompatibility", ["providerKey", "provider_key"], details);

  capabilities.items.forEach(({ entry, index }) => {
    if (!isPlainObject(entry)) return;
    if (entry.version != null && (!Number.isInteger(Number(entry.version)) || Number(entry.version) < 1)) {
      details.push({ field: `capabilities[${index}].version`, issue: "must_be_positive_integer" });
    }
  });
  workflows.items.forEach(({ entry, index }) => validateActivityPackWorkflow(entry, index, capabilities.keys, details));
  validateActivityPackCompatibilityEntries(policies.items, "policies", capabilities.keys, workflows.keys, details);
  validateActivityPackCompatibilityEntries(providers.items, "providerCompatibility", capabilities.keys, workflows.keys, details);

  if (Array.isArray(manifest.tests?.compatibilityDeclarations)) {
    manifest.tests.compatibilityDeclarations.forEach((declaration, index) => {
      const field = `tests.compatibilityDeclarations[${index}]`;
      if (!isPlainObject(declaration)) {
        details.push({ field, issue: "must_be_object" });
        return;
      }
      const capabilityKey = declaration.capabilityKey ?? declaration.capability_key;
      const workflowKey = declaration.workflowKey ?? declaration.workflow_key;
      const providerKey = declaration.providerKey ?? declaration.provider_key;
      if (capabilityKey != null) {
        const normalized = activityPackCanonicalKey(capabilityKey, `${field}.capabilityKey`, details);
        if (normalized && !capabilities.keys.has(normalized)) details.push({ field: `${field}.capabilityKey`, issue: "unknown_capability_reference", key: normalized });
      }
      if (workflowKey != null) {
        const normalized = activityPackCanonicalKey(workflowKey, `${field}.workflowKey`, details);
        if (normalized && !workflows.keys.has(normalized)) details.push({ field: `${field}.workflowKey`, issue: "unknown_workflow_reference", key: normalized });
      }
      if (providerKey != null) {
        const normalized = activityPackCanonicalKey(providerKey, `${field}.providerKey`, details);
        if (normalized && !providers.keys.has(normalized)) details.push({ field: `${field}.providerKey`, issue: "unknown_provider_reference", key: normalized });
      }
    });
  } else if (manifest.tests?.compatibilityDeclarations != null) {
    details.push({ field: "tests.compatibilityDeclarations", issue: "must_be_array" });
  }

  collectForbiddenActivityPackPointers(manifest, "$", details);
  void kpis;
  if (details.length) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_PACK_INVALID", "Activity Pack manifest is incomplete or invalid.", 422, details);
  return Object.freeze({ manifest: canonicalize(manifest), checksumSha256: stableSha256(manifest), secretsIncluded: false });
}

export function normalizeBrandActivityBinding(input = {}) {
  const required = ["tenantId","workspaceId","brandKey","activityTypeKey","activityPackKey","activityPackVersion"];
  const details = required.filter((field) => input[field] == null || String(input[field]).trim() === "").map((field) => ({ field, issue: "required" }));
  if (details.length) throw new GrowthControlPlaneError("GROWTH_CONTROL_BINDING_INVALID", "Brand activity binding is incomplete.", 422, details);
  const binding = {
    tenantId: clean(input.tenantId), workspaceId: clean(input.workspaceId), brandKey: clean(input.brandKey),
    activityTypeKey: requireCanonicalKey(input.activityTypeKey, "activityTypeKey"),
    activityPackKey: requireCanonicalKey(input.activityPackKey, "activityPackKey"),
    activityPackVersion: Number(input.activityPackVersion),
    markets: Array.isArray(input.markets) ? uniqueSorted(input.markets.map(String)) : [],
    locales: Array.isArray(input.locales) ? uniqueSorted(input.locales.map(String)) : [],
    channels: Array.isArray(input.channels) ? uniqueSorted(input.channels.map(String)) : [],
    objectives: Array.isArray(input.objectives) ? uniqueSorted(input.objectives.map(String)) : [],
    allowedCapabilities: Array.isArray(input.allowedCapabilities) ? uniqueSorted(input.allowedCapabilities.map((key) => requireCanonicalKey(key, "allowedCapabilities"))) : [],
    status: "draft"
  };
  if (!Number.isInteger(binding.activityPackVersion) || binding.activityPackVersion < 1) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_BINDING_INVALID", "activityPackVersion must be a positive integer.", 422);
  }
  assertNoSecretFields(binding);
  return Object.freeze(binding);
}

export const GROWTH_CONTROL_CONFIGURATION_LIFECYCLE_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["ready", "blocked", "archived"]),
  validating: Object.freeze(["ready", "blocked"]),
  ready: Object.freeze(["active", "blocked", "archived"]),
  active: Object.freeze(["rolled_back", "deprecated"]),
  blocked: Object.freeze(["draft", "archived"]),
  deprecated: Object.freeze(["active", "archived"]),
  archived: Object.freeze([]),
  rolled_back: Object.freeze(["active", "archived"])
});

export function assertGrowthControlConfigurationTransition(currentLifecycle, nextLifecycle) {
  const current = clean(currentLifecycle);
  const next = clean(nextLifecycle);
  const allowed = GROWTH_CONTROL_CONFIGURATION_LIFECYCLE_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_LIFECYCLE_TRANSITION_INVALID",
      `Configuration lifecycle cannot transition from ${current || "unknown"} to ${next || "unknown"}.`,
      409,
      [{ field: "lifecycle", issue: "transition_not_allowed", current, next }]
    );
  }
  return Object.freeze({ current, next });
}

export function buildGrowthControlApprovalBinding({ operation, version } = {}) {
  const normalizedOperation = clean(operation);
  if (!new Set(["activate", "rollback"]).has(normalizedOperation)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_APPROVAL_OPERATION_INVALID",
      "Approval operation must be activate or rollback.",
      422,
      [{ field: "operation", issue: "unsupported" }]
    );
  }
  if (!version?.configVersionId || !version?.configKey || !version?.scopeKey || !version?.checksumSha256) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_APPROVAL_BINDING_INVALID",
      "Configuration version identity is incomplete for approval binding.",
      422
    );
  }
  const binding = {
    approvalType: "growth_control_configuration_lifecycle",
    operation: normalizedOperation,
    configVersionId: String(version.configVersionId),
    configKey: String(version.configKey),
    scopeKey: String(version.scopeKey),
    checksumSha256: String(version.checksumSha256),
    versionRevision: Number(version.versionRevision || 0)
  };
  assertNoSecretFields(binding);
  return Object.freeze({ ...binding, bindingSha256: stableSha256(binding) });
}

export function assertGrowthControlApprovalHold(hold, expectedBinding, now = new Date()) {
  if (!hold || hold.status !== "approved") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_APPROVAL_REQUIRED",
      "An approved plan-bound lifecycle hold is required.",
      403
    );
  }
  if (hold.expiresAt && new Date(hold.expiresAt).getTime() <= now.getTime()) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_APPROVAL_EXPIRED",
      "The lifecycle approval hold has expired.",
      403
    );
  }
  const context = hold.executionContext || {};
  if (context.bindingSha256 !== expectedBinding.bindingSha256) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_APPROVAL_BINDING_MISMATCH",
      "The lifecycle approval hold is bound to a different operation or version.",
      403
    );
  }
  return true;
}
