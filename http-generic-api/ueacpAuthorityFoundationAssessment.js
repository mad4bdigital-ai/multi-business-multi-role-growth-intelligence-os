import crypto from "node:crypto";

export const UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS = Object.freeze([
  "principal_authority", "subject_scope_authority", "delegation_context_authority",
  "resource_relation_authority", "resource_restriction_authority", "policy_grant_authority",
  "connection_authority", "endpoint_certification_authority", "decision_evidence_ledger",
  "projection_snapshot_ledger", "invalidation_event_ledger", "drift_finding_ledger",
]);
export const UEACP_AUTHORITY_FOUNDATION_DISPOSITIONS = Object.freeze(["reuse", "extend", "create", "blocked"]);
export const UEACP_AUTHORITY_FOUNDATION_REVISION_STRATEGIES = Object.freeze([
  "existing_explicit_revision", "add_explicit_revision", "append_only_event_revision",
  "immutable_version_pointer", "not_applicable",
]);
export const UEACP_AUTHORITY_FOUNDATION_STORAGE_SEMANTICS = Object.freeze([
  "source_authority", "derived_projection", "append_only_evidence", "append_only_event",
]);

const CLASSIFICATION_CONTRACT = "mad4b.ueacp-authority-foundation-classification.v1";
const PATH_INVENTORY_CONTRACT = "mad4b.ueacp-authority-path-inventory.v1";
const TOKEN = /^[a-z][a-z0-9_]{1,190}$/;
const SHA = /^[a-f0-9]{64}$/;
const SENSITIVE = /(authorization|cookie|credential|secret|token|password|private.?key|api.?key)/i;
const SAFE_MARKER_KEYS = new Set(["credential_payload_read", "secrets_included", "provider_calls", "external_writes"]);

export class UeacpAuthorityFoundationAssessmentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "UeacpAuthorityFoundationAssessmentError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
const fail = (code, message, details = {}) => { throw new UeacpAuthorityFoundationAssessmentError(code, message, details); };

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
const hash = (value, prefix) => crypto.createHash("sha256").update(`${prefix}:${stableStringify(value)}`).digest("hex");
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}
function rejectSensitive(value, path = "evidence", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE.test(key) && !SAFE_MARKER_KEYS.has(key)) fail("ueacp_foundation_sensitive_field", "UEACP evidence cannot contain secret-bearing fields.", { path: `${path}.${key}` });
    rejectSensitive(child, `${path}.${key}`, seen);
  }
}
function token(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!TOKEN.test(normalized)) fail("ueacp_foundation_invalid_token", `${field} must be a stable lowercase token.`, { field });
  return normalized;
}
function choice(value, allowed, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!allowed.includes(normalized)) fail("ueacp_foundation_invalid_enum", `${field} is not supported.`, { field, value: normalized, allowed });
  return normalized;
}
function text(value, field, min = 1, max = 2000) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < min || normalized.length > max) fail("ueacp_foundation_invalid_text", `${field} must be between ${min} and ${max} characters.`, { field });
  return normalized;
}
function list(value, field, { min = 0, max = 20, tokens = false } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail("ueacp_foundation_invalid_list", `${field} has an invalid item count.`, { field, min, max });
  return [...new Set(value.map((item) => tokens ? token(item, field) : text(item, field, 1, 300)))].sort();
}
function assertCensus(census) {
  if (!census || typeof census !== "object" || Array.isArray(census)) fail("ueacp_foundation_invalid_census", "A read-only authority census is required.");
  if (census.ok !== true || census.read_only !== true || census.applies_sql !== false) fail("ueacp_foundation_unsafe_census", "The census must be successful, read-only, and non-applying.");
  if (!Array.isArray(census.objects) || !Array.isArray(census.revision_support)) fail("ueacp_foundation_incomplete_census", "The census must include objects and revision support.");
  if (census.provider_calls !== false || census.credential_payload_read !== false || census.external_writes !== false || census.secrets_included !== false) fail("ueacp_foundation_unsafe_census", "The census safety markers are not acceptable.");
}
function censusInput(census) {
  return {
    schema_name: census.schema_name,
    database_server: census.database_server,
    objects: census.objects,
    columns: census.columns,
    indexes: census.indexes,
    foreign_keys: census.foreign_keys,
    views: census.views,
    revision_support: census.revision_support,
  };
}
export function createUeacpAuthorityCensusFingerprint(census) {
  assertCensus(census);
  return hash(censusInput(census), "ueacp-authority-census-v1");
}

function normalizeAuthorityPathInventory(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) fail("ueacp_foundation_invalid_path_inventory", "An Admin/Tenant authority-path inventory is required.");
  rejectSensitive(inventory, "authority_path_inventory");
  if (inventory.contract !== PATH_INVENTORY_CONTRACT) fail("ueacp_foundation_invalid_path_inventory_contract", "Unsupported authority-path inventory contract.", { contract: inventory.contract ?? null });
  const coverage = inventory.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) fail("ueacp_foundation_invalid_path_inventory", "Authority-path inventory coverage is required.");
  const unresolvedCount = Number(coverage.unresolved_path_count);
  if (coverage.admin_complete !== true || coverage.tenant_complete !== true || !Number.isSafeInteger(unresolvedCount) || unresolvedCount !== 0) {
    fail("ueacp_foundation_incomplete_path_inventory", "Admin and Tenant authority-path inventory must be complete with zero unresolved paths.");
  }
  if (!Array.isArray(inventory.paths) || inventory.paths.length < 2 || inventory.paths.length > 4096) fail("ueacp_foundation_invalid_path_inventory", "Authority-path inventory must contain between 2 and 4096 paths.");
  const seen = new Set();
  const paths = inventory.paths.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("ueacp_foundation_invalid_path_inventory", "Each authority path must be an object.");
    const surface = choice(raw.surface, ["admin", "tenant"], "surface");
    const pathKey = token(raw.path_key, "path_key");
    const identity = `${surface}:${pathKey}`;
    if (seen.has(identity)) fail("ueacp_foundation_duplicate_authority_path", "Authority path is declared more than once.", { identity });
    seen.add(identity);
    return {
      surface,
      path_key: pathKey,
      source_ref: text(raw.source_ref, "source_ref", 3, 300),
      authority_owner_key: token(raw.authority_owner_key, "authority_owner_key"),
      operation_class: choice(raw.operation_class, ["read", "mutation", "mixed"], "operation_class"),
      projection_only: raw.projection_only === true,
      evidence_refs: list(raw.evidence_refs, "evidence_refs", { min: 1 }),
    };
  }).sort((left, right) => `${left.surface}:${left.path_key}`.localeCompare(`${right.surface}:${right.path_key}`));
  if (!paths.some((item) => item.surface === "admin") || !paths.some((item) => item.surface === "tenant")) fail("ueacp_foundation_incomplete_path_inventory", "Authority-path inventory must include both Admin and Tenant paths.");
  const safety = inventory.safety;
  if (!safety || safety.read_only !== true || safety.provider_calls !== false || safety.credential_payload_read !== false || safety.external_writes !== false || safety.secrets_included !== false) fail("ueacp_foundation_unsafe_path_inventory", "Authority-path inventory safety markers are not acceptable.");
  return {
    contract: PATH_INVENTORY_CONTRACT,
    coverage: { admin_complete: true, tenant_complete: true, unresolved_path_count: 0 },
    paths,
    safety: { read_only: true, provider_calls: false, credential_payload_read: false, external_writes: false, secrets_included: false },
  };
}
export function createUeacpAuthorityPathInventoryFingerprint(inventory) {
  return hash(normalizeAuthorityPathInventory(inventory), "ueacp-authority-path-inventory-v1");
}

function normalizeClassification(raw, objectByName, revisionByName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("ueacp_foundation_invalid_classification", "Each classification must be an object.");
  rejectSensitive(raw, "classification");
  const logicalKey = token(raw.logical_key, "logical_key");
  if (!UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS.includes(logicalKey)) fail("ueacp_foundation_unknown_logical_key", "Unknown UEACP logical authority key.", { logical_key: logicalKey });
  const disposition = choice(raw.disposition, UEACP_AUTHORITY_FOUNDATION_DISPOSITIONS, "disposition");
  const revisionStrategy = choice(raw.revision_strategy, UEACP_AUTHORITY_FOUNDATION_REVISION_STRATEGIES, "revision_strategy");
  const storageSemantics = choice(raw.storage_semantics, UEACP_AUTHORITY_FOUNDATION_STORAGE_SEMANTICS, "storage_semantics");
  const objectNames = list(raw.object_names ?? [], "object_names", { tokens: true });
  const proposed = raw.proposed_object_name == null ? null : token(raw.proposed_object_name, "proposed_object_name");
  const approved = raw.approved === true;
  const sharedObject = raw.shared_object === true;
  const sharedReason = sharedObject ? text(raw.shared_reason, "shared_reason", 12, 1000) : null;

  if (["reuse", "extend"].includes(disposition) && objectNames.length !== 1) fail("ueacp_foundation_invalid_existing_binding", "Reuse or extension requires exactly one existing object.", { logical_key: logicalKey });
  if (disposition === "create" && (!proposed || objectNames.length)) fail("ueacp_foundation_invalid_create_binding", "Create requires one proposed object and no existing binding.", { logical_key: logicalKey });
  if (disposition === "blocked" && approved) fail("ueacp_foundation_blocked_approved", "A blocked classification cannot be approved.", { logical_key: logicalKey });
  for (const name of objectNames) if (!objectByName.has(name)) fail("ueacp_foundation_unknown_object", "Classification references an object absent from the census.", { logical_key: logicalKey, object_name: name });
  if (proposed && objectByName.has(proposed)) fail("ueacp_foundation_create_conflict", "A proposed object already exists and must be reused or extended.", { logical_key: logicalKey, object_name: proposed });

  const support = objectNames.length === 1 ? revisionByName.get(objectNames[0])?.support ?? "unknown" : "not_applicable";
  if (revisionStrategy === "existing_explicit_revision" && support !== "explicit_revision") fail("ueacp_foundation_revision_mismatch", "Explicit revision strategy requires observed explicit revision support.", { logical_key: logicalKey, observed_support: support });
  if (disposition === "reuse" && revisionStrategy === "add_explicit_revision") fail("ueacp_foundation_revision_mismatch", "Adding revision support requires extension, not reuse.", { logical_key: logicalKey });
  if (disposition === "blocked" && revisionStrategy !== "not_applicable") fail("ueacp_foundation_revision_mismatch", "Blocked classifications must use not_applicable revision strategy.", { logical_key: logicalKey });

  return {
    logical_key: logicalKey,
    disposition,
    owner_key: token(raw.owner_key, "owner_key"),
    approved,
    storage_semantics: storageSemantics,
    revision_strategy: revisionStrategy,
    existing_revision_support: support,
    object_names: objectNames,
    proposed_object_name: proposed,
    shared_object: sharedObject,
    shared_reason: sharedReason,
    evidence_refs: list(raw.evidence_refs, "evidence_refs", { min: 1 }),
    rationale: text(raw.rationale, "rationale", 12, 2000),
    migration_action: disposition === "extend" ? "alter_existing_additive" : disposition === "create" ? "create_additive" : "none",
  };
}

export function assessUeacpAuthorityFoundation({ census, authorityPathInventory, classificationBundle, requiredLogicalKeys = UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS } = {}) {
  assertCensus(census);
  const normalizedPathInventory = normalizeAuthorityPathInventory(authorityPathInventory);
  if (!classificationBundle || typeof classificationBundle !== "object" || Array.isArray(classificationBundle)) fail("ueacp_foundation_invalid_bundle", "A classification bundle is required.");
  rejectSensitive(classificationBundle, "classification_bundle");
  if (classificationBundle.contract !== CLASSIFICATION_CONTRACT) fail("ueacp_foundation_invalid_contract", "Unsupported classification contract.", { contract: classificationBundle.contract ?? null });
  const required = list(requiredLogicalKeys, "requiredLogicalKeys", { min: 1, max: 12, tokens: true });
  required.forEach((key) => { if (!UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS.includes(key)) fail("ueacp_foundation_unknown_logical_key", "Unknown required logical key.", { logical_key: key }); });
  if (!Array.isArray(classificationBundle.classifications)) fail("ueacp_foundation_invalid_bundle", "classifications must be an array.");

  const objectByName = new Map(census.objects.map((item) => [String(item.object_name).toLowerCase(), item]));
  const revisionByName = new Map(census.revision_support.map((item) => [String(item.object_name).toLowerCase(), item]));
  const classifications = classificationBundle.classifications.map((item) => normalizeClassification(item, objectByName, revisionByName)).sort((a, b) => a.logical_key.localeCompare(b.logical_key));
  const logicalKeys = new Set();
  const objectOwners = new Map();
  for (const item of classifications) {
    if (logicalKeys.has(item.logical_key)) fail("ueacp_foundation_duplicate_logical_key", "A logical key is classified more than once.", { logical_key: item.logical_key });
    logicalKeys.add(item.logical_key);
    for (const name of item.object_names) {
      const owners = objectOwners.get(name) ?? [];
      owners.push(item);
      objectOwners.set(name, owners);
    }
  }
  for (const [name, owners] of objectOwners) if (owners.length > 1 && !owners.every((item) => item.shared_object && item.shared_reason)) fail("ueacp_foundation_ambiguous_object_ownership", "One physical object cannot silently own multiple logical semantics.", { object_name: name, logical_keys: owners.map((item) => item.logical_key).sort() });

  const missing = required.filter((key) => !logicalKeys.has(key));
  const unexpected = classifications.map((item) => item.logical_key).filter((key) => !required.includes(key));
  const blocked = classifications.filter((item) => item.disposition === "blocked").map((item) => item.logical_key);
  const unapproved = classifications.filter((item) => !item.approved).map((item) => item.logical_key);
  const censusSha = createUeacpAuthorityCensusFingerprint(census);
  const suppliedCensusSha = String(classificationBundle.census_sha256 ?? "").trim().toLowerCase();
  const censusBound = SHA.test(suppliedCensusSha) && suppliedCensusSha === censusSha;
  const pathSha = createUeacpAuthorityPathInventoryFingerprint(normalizedPathInventory);
  const suppliedPathSha = String(classificationBundle.authority_path_inventory_sha256 ?? "").trim().toLowerCase();
  const pathRef = String(classificationBundle.authority_path_inventory_ref ?? "").trim();
  const pathBound = SHA.test(suppliedPathSha) && suppliedPathSha === pathSha && pathRef.length >= 3 && pathRef.length <= 300;
  const complete = !missing.length && !unexpected.length && !blocked.length && !unapproved.length && censusBound && pathBound;
  const normalized = {
    contract: CLASSIFICATION_CONTRACT,
    schema_name: text(census.schema_name, "census.schema_name", 1, 190),
    census_sha256: censusSha,
    authority_path_inventory_sha256: pathSha,
    authority_path_inventory_ref: pathRef,
    classification_source: text(classificationBundle.classification_source, "classification_source", 3, 300),
    classifications,
  };

  return deepFreeze({
    contract: "mad4b.ueacp-authority-foundation-assessment.v1",
    ok: complete,
    status: complete ? "ready_for_additive_migration_design" : "blocked_pending_authority_classification",
    schema_name: normalized.schema_name,
    census_sha256: censusSha,
    supplied_census_sha256: suppliedCensusSha || null,
    census_bound: censusBound,
    authority_path_inventory_sha256: pathSha,
    supplied_authority_path_inventory_sha256: suppliedPathSha || null,
    authority_path_inventory_ref: pathRef || null,
    authority_path_inventory_bound: pathBound,
    authority_path_count: normalizedPathInventory.paths.length,
    assessment_sha256: hash(normalized, "ueacp-authority-foundation-assessment-v1"),
    classifications,
    migration_actions: classifications.filter((item) => item.migration_action !== "none").map((item) => ({
      logical_key: item.logical_key,
      action: item.migration_action,
      object_name: item.object_names[0] ?? item.proposed_object_name,
      revision_strategy: item.revision_strategy,
    })),
    blockers: {
      missing_logical_keys: missing,
      unexpected_logical_keys: unexpected,
      blocked_logical_keys: blocked,
      unapproved_logical_keys: unapproved,
      census_fingerprint_mismatch: !censusBound,
      authority_path_inventory_mismatch: !pathBound,
    },
    closure_state: {
      t001_authority_path_inventory_complete: complete,
      t002_live_table_ownership_complete: complete,
      t021_revision_design_authorized: complete,
      t022_t024_storage_design_authorized: complete,
      migration_apply_authorized: false,
      runtime_consumer_activation_authorized: false,
    },
    safety: {
      read_only: true,
      applies_sql: false,
      provider_calls: false,
      credential_payload_read: false,
      external_writes: false,
      secrets_included: false,
      runtime_authority_changed: false,
    },
  });
}

export const _testingUeacpAuthorityFoundationAssessment = Object.freeze({
  stableStringify,
  sha256: hash,
  deepFreeze,
  assertNoSensitiveKeys: rejectSensitive,
  normalizeAuthorityPathInventory,
  normalizeClassification,
});
