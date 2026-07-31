import crypto from "node:crypto";

export const UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS = Object.freeze([
  "principal_authority",
  "subject_scope_authority",
  "delegation_context_authority",
  "resource_relation_authority",
  "resource_restriction_authority",
  "policy_grant_authority",
  "connection_authority",
  "endpoint_certification_authority",
  "decision_evidence_ledger",
  "projection_snapshot_ledger",
  "invalidation_event_ledger",
  "drift_finding_ledger",
]);

export const UEACP_AUTHORITY_FOUNDATION_DISPOSITIONS = Object.freeze([
  "reuse",
  "extend",
  "create",
  "blocked",
]);

export const UEACP_AUTHORITY_FOUNDATION_REVISION_STRATEGIES = Object.freeze([
  "existing_explicit_revision",
  "add_explicit_revision",
  "append_only_event_revision",
  "immutable_version_pointer",
  "not_applicable",
]);

export const UEACP_AUTHORITY_FOUNDATION_STORAGE_SEMANTICS = Object.freeze([
  "source_authority",
  "derived_projection",
  "append_only_evidence",
  "append_only_event",
]);

const TOKEN_PATTERN = /^[a-z][a-z0-9_]{1,190}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|secret|token|password|private.?key|api.?key)/i;

export class UeacpAuthorityFoundationAssessmentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "UeacpAuthorityFoundationAssessmentError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value, prefix) {
  return crypto.createHash("sha256").update(`${prefix}:${stableStringify(value)}`).digest("hex");
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertNoSensitiveKeys(value, path = "classification", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new UeacpAuthorityFoundationAssessmentError(
        "ueacp_foundation_sensitive_field",
        "Authority foundation classifications cannot contain secret-bearing fields.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveKeys(child, `${path}.${key}`, seen);
  }
}

function requireToken(value, fieldName) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_token",
      `${fieldName} must be a stable lowercase token.`,
      { field: fieldName },
    );
  }
  return normalized;
}

function requireEnum(value, allowed, fieldName) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_enum",
      `${fieldName} is not supported.`,
      { field: fieldName, value: normalized, allowed },
    );
  }
  return normalized;
}

function normalizeString(value, fieldName, { minimum = 1, maximum = 2000 } = {}) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_text",
      `${fieldName} must be between ${minimum} and ${maximum} characters.`,
      { field: fieldName },
    );
  }
  return normalized;
}

function normalizeEvidenceRefs(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_evidence",
      `${fieldName} must contain between 1 and 20 evidence references.`,
      { field: fieldName },
    );
  }
  const refs = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].sort();
  if (refs.length === 0 || refs.some((item) => item.length > 300)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_evidence",
      `${fieldName} contains an invalid evidence reference.`,
      { field: fieldName },
    );
  }
  return refs;
}

function normalizeObjectNames(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_objects",
      `${fieldName} must be an array with at most 20 object names.`,
      { field: fieldName },
    );
  }
  return [...new Set(value.map((item) => requireToken(item, fieldName)))].sort();
}

function assertCensus(census) {
  if (!census || typeof census !== "object" || Array.isArray(census)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_census",
      "A read-only authority catalog census is required.",
    );
  }
  if (census.ok !== true || census.read_only !== true || census.applies_sql !== false) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_unsafe_census",
      "The authority census must be successful, read-only, and non-applying.",
    );
  }
  if (!Array.isArray(census.objects) || !Array.isArray(census.revision_support)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_incomplete_census",
      "The authority census must include objects and revision support.",
    );
  }
  if (census.provider_calls !== false || census.credential_payload_read !== false
      || census.external_writes !== false || census.secrets_included !== false) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_unsafe_census",
      "The authority census safety markers are not acceptable.",
    );
  }
}

function normalizeClassification(raw, objectByName, revisionByName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_classification",
      "Each authority classification must be an object.",
    );
  }
  assertNoSensitiveKeys(raw);

  const logicalKey = requireToken(raw.logical_key, "logical_key");
  if (!UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS.includes(logicalKey)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_unknown_logical_key",
      "The classification logical key is not part of the UEACP foundation contract.",
      { logical_key: logicalKey },
    );
  }

  const disposition = requireEnum(raw.disposition, UEACP_AUTHORITY_FOUNDATION_DISPOSITIONS, "disposition");
  const revisionStrategy = requireEnum(
    raw.revision_strategy,
    UEACP_AUTHORITY_FOUNDATION_REVISION_STRATEGIES,
    "revision_strategy",
  );
  const storageSemantics = requireEnum(
    raw.storage_semantics,
    UEACP_AUTHORITY_FOUNDATION_STORAGE_SEMANTICS,
    "storage_semantics",
  );
  const ownerKey = requireToken(raw.owner_key, "owner_key");
  const objectNames = normalizeObjectNames(raw.object_names, "object_names");
  const proposedObjectName = raw.proposed_object_name == null
    ? null
    : requireToken(raw.proposed_object_name, "proposed_object_name");
  const evidenceRefs = normalizeEvidenceRefs(raw.evidence_refs, "evidence_refs");
  const rationale = normalizeString(raw.rationale, "rationale", { minimum: 12, maximum: 2000 });
  const approved = raw.approved === true;
  const sharedObject = raw.shared_object === true;
  const sharedReason = sharedObject
    ? normalizeString(raw.shared_reason, "shared_reason", { minimum: 12, maximum: 1000 })
    : null;

  if (["reuse", "extend"].includes(disposition) && objectNames.length !== 1) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_existing_binding",
      "Reuse or extension requires exactly one existing schema object.",
      { logical_key: logicalKey, disposition },
    );
  }
  if (disposition === "create" && (!proposedObjectName || objectNames.length !== 0)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_create_binding",
      "Create requires one proposed object name and no existing object binding.",
      { logical_key: logicalKey },
    );
  }
  if (disposition === "blocked" && approved) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_blocked_approved",
      "A blocked classification cannot be approved.",
      { logical_key: logicalKey },
    );
  }

  for (const objectName of objectNames) {
    if (!objectByName.has(objectName)) {
      throw new UeacpAuthorityFoundationAssessmentError(
        "ueacp_foundation_unknown_object",
        "A classification references an object absent from the observed census.",
        { logical_key: logicalKey, object_name: objectName },
      );
    }
  }
  if (proposedObjectName && objectByName.has(proposedObjectName)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_create_conflict",
      "A proposed object already exists and must be classified as reuse or extension.",
      { logical_key: logicalKey, object_name: proposedObjectName },
    );
  }

  const existingRevisionSupport = objectNames.length === 1
    ? revisionByName.get(objectNames[0])?.support ?? "unknown"
    : "not_applicable";

  if (revisionStrategy === "existing_explicit_revision" && existingRevisionSupport !== "explicit_revision") {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_revision_mismatch",
      "Existing explicit revision strategy requires observed explicit revision support.",
      { logical_key: logicalKey, observed_support: existingRevisionSupport },
    );
  }
  if (disposition === "reuse" && revisionStrategy === "add_explicit_revision") {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_revision_mismatch",
      "Adding a revision changes schema and therefore requires extension, not reuse.",
      { logical_key: logicalKey },
    );
  }
  if (disposition === "blocked" && revisionStrategy !== "not_applicable") {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_revision_mismatch",
      "Blocked classifications must use not_applicable revision strategy.",
      { logical_key: logicalKey },
    );
  }

  const migrationAction = disposition === "extend"
    ? "alter_existing_additive"
    : disposition === "create"
      ? "create_additive"
      : "none";

  return {
    logical_key: logicalKey,
    disposition,
    owner_key: ownerKey,
    approved,
    storage_semantics: storageSemantics,
    revision_strategy: revisionStrategy,
    existing_revision_support: existingRevisionSupport,
    object_names: objectNames,
    proposed_object_name: proposedObjectName,
    shared_object: sharedObject,
    shared_reason: sharedReason,
    evidence_refs: evidenceRefs,
    rationale,
    migration_action: migrationAction,
  };
}

export function createUeacpAuthorityCensusFingerprint(census) {
  assertCensus(census);
  return sha256({
    schema_name: census.schema_name,
    database_server: census.database_server,
    objects: census.objects,
    columns: census.columns,
    indexes: census.indexes,
    foreign_keys: census.foreign_keys,
    views: census.views,
    revision_support: census.revision_support,
  }, "ueacp-authority-census-v1");
}

export function assessUeacpAuthorityFoundation({
  census,
  classificationBundle,
  requiredLogicalKeys = UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS,
} = {}) {
  assertCensus(census);
  if (!classificationBundle || typeof classificationBundle !== "object" || Array.isArray(classificationBundle)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_bundle",
      "An authority ownership classification bundle is required.",
    );
  }
  assertNoSensitiveKeys(classificationBundle, "classification_bundle");

  const schemaName = normalizeString(census.schema_name, "census.schema_name", { maximum: 190 });
  const required = [...new Set(requiredLogicalKeys.map((key) => requireToken(key, "requiredLogicalKeys")))].sort();
  for (const key of required) {
    if (!UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS.includes(key)) {
      throw new UeacpAuthorityFoundationAssessmentError(
        "ueacp_foundation_unknown_logical_key",
        "The required logical key is not part of the UEACP foundation contract.",
        { logical_key: key },
      );
    }
  }

  if (!Array.isArray(classificationBundle.classifications)) {
    throw new UeacpAuthorityFoundationAssessmentError(
      "ueacp_foundation_invalid_bundle",
      "classificationBundle.classifications must be an array.",
    );
  }

  const objectByName = new Map(census.objects.map((item) => [String(item.object_name).toLowerCase(), item]));
  const revisionByName = new Map(census.revision_support.map((item) => [String(item.object_name).toLowerCase(), item]));
  const classifications = classificationBundle.classifications
    .map((item) => normalizeClassification(item, objectByName, revisionByName))
    .sort((left, right) => left.logical_key.localeCompare(right.logical_key));

  const logicalKeys = new Set();
  const objectOwners = new Map();
  for (const classification of classifications) {
    if (logicalKeys.has(classification.logical_key)) {
      throw new UeacpAuthorityFoundationAssessmentError(
        "ueacp_foundation_duplicate_logical_key",
        "A logical authority key is classified more than once.",
        { logical_key: classification.logical_key },
      );
    }
    logicalKeys.add(classification.logical_key);
    for (const objectName of classification.object_names) {
      if (!objectOwners.has(objectName)) objectOwners.set(objectName, []);
      objectOwners.get(objectName).push(classification);
    }
  }

  for (const [objectName, owners] of objectOwners.entries()) {
    if (owners.length <= 1) continue;
    if (!owners.every((item) => item.shared_object && item.shared_reason)) {
      throw new UeacpAuthorityFoundationAssessmentError(
        "ueacp_foundation_ambiguous_object_ownership",
        "One physical object cannot silently own multiple logical authority semantics.",
        { object_name: objectName, logical_keys: owners.map((item) => item.logical_key).sort() },
      );
    }
  }

  const missingLogicalKeys = required.filter((key) => !logicalKeys.has(key));
  const unexpectedLogicalKeys = classifications.map((item) => item.logical_key).filter((key) => !required.includes(key));
  const blockedLogicalKeys = classifications.filter((item) => item.disposition === "blocked").map((item) => item.logical_key);
  const unapprovedLogicalKeys = classifications.filter((item) => !item.approved).map((item) => item.logical_key);
  const migrationActions = classifications
    .filter((item) => item.migration_action !== "none")
    .map((item) => ({
      logical_key: item.logical_key,
      action: item.migration_action,
      object_name: item.object_names[0] ?? item.proposed_object_name,
      revision_strategy: item.revision_strategy,
    }));

  const censusFingerprint = createUeacpAuthorityCensusFingerprint(census);
  const suppliedFingerprint = String(classificationBundle.census_sha256 ?? "").trim().toLowerCase();
  const censusBound = SHA256_PATTERN.test(suppliedFingerprint) && suppliedFingerprint === censusFingerprint;
  const complete = missingLogicalKeys.length === 0
    && unexpectedLogicalKeys.length === 0
    && blockedLogicalKeys.length === 0
    && unapprovedLogicalKeys.length === 0
    && censusBound;

  const normalizedBundle = {
    contract: "mad4b.ueacp-authority-foundation-classification.v1",
    schema_name: schemaName,
    census_sha256: censusFingerprint,
    classification_source: normalizeString(
      classificationBundle.classification_source,
      "classification_source",
      { minimum: 3, maximum: 300 },
    ),
    classifications,
  };
  const assessmentSha256 = sha256(normalizedBundle, "ueacp-authority-foundation-assessment-v1");

  return deepFreeze({
    contract: "mad4b.ueacp-authority-foundation-assessment.v1",
    ok: complete,
    status: complete ? "ready_for_additive_migration_design" : "blocked_pending_authority_classification",
    schema_name: schemaName,
    census_sha256: censusFingerprint,
    supplied_census_sha256: suppliedFingerprint || null,
    census_bound: censusBound,
    assessment_sha256: assessmentSha256,
    classifications,
    migration_actions: migrationActions,
    blockers: {
      missing_logical_keys: missingLogicalKeys,
      unexpected_logical_keys: unexpectedLogicalKeys,
      blocked_logical_keys: blockedLogicalKeys,
      unapproved_logical_keys: unapprovedLogicalKeys,
      census_fingerprint_mismatch: !censusBound,
    },
    closure_state: {
      t001_inventory_evidence_ready: complete,
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
  sha256,
  deepFreeze,
  assertNoSensitiveKeys,
  normalizeClassification,
});
