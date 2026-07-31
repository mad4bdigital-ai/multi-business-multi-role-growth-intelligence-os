import crypto from "node:crypto";

const OWNERSHIP_CLASSES = Object.freeze(new Set([
  "source_authority",
  "shared_authority",
  "derived_projection",
  "evidence_ledger",
  "non_authoritative",
]));
const REVISION_STRATEGIES = Object.freeze(new Set([
  "reuse_explicit_revision",
  "add_explicit_revision",
  "add_revision",
  "not_applicable",
]));
const AUTHORITY_CLASSES = new Set(["source_authority", "shared_authority"]);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityOwnershipReviewError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityOwnershipReviewError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSort(value[key]);
    return result;
  }, {});
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableSort(value))).digest("hex");
}

function assertNoSensitiveValues(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityOwnershipReviewError(
        "authority_ownership_secret_value_forbidden",
        "Authority ownership review contains a forbidden sensitive value.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_token",
      `${field} must be a stable bounded token.`,
      { field },
    );
  }
  return normalized;
}

function timestamp(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_timestamp",
      `${field} must be a valid timestamp.`,
      { field },
    );
  }
  return parsed.toISOString();
}

function enumValue(value, allowed, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_enum",
      `${field} contains an unsupported value.`,
      { field, value: normalized || null },
    );
  }
  return normalized;
}

function boolean(value, field) {
  if (typeof value !== "boolean") {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_boolean",
      `${field} must be boolean.`,
      { field },
    );
  }
  return value;
}

function stringList(value, field, { minItems = 0, maxItems = 64 } = {}) {
  if (!Array.isArray(value)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_list",
      `${field} must be an array.`,
      { field },
    );
  }
  if (value.length < minItems || value.length > maxItems) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_list_size",
      `${field} has an invalid item count.`,
      { field, minimum: minItems, maximum: maxItems, observed: value.length },
    );
  }
  return [...new Set(value.map((item, index) => token(item, `${field}[${index}]`)))].sort();
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new AuthorityOwnershipReviewError("authority_ownership_invalid_catalog", "catalog_census must be an object.");
  }
  if (catalog.mode !== "read_only_authority_catalog_census" || catalog.read_only !== true || catalog.applies_sql !== false) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_untrusted_catalog",
      "catalog_census must be the canonical read-only census contract.",
    );
  }
  if (!Array.isArray(catalog.objects) || !Array.isArray(catalog.revision_support)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_incomplete_catalog",
      "catalog_census must include objects and revision_support.",
    );
  }
  if (catalog.provider_calls !== false || catalog.credential_payload_read !== false || catalog.external_writes !== false || catalog.secrets_included !== false) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_unsafe_catalog",
      "catalog_census safety markers are not satisfied.",
    );
  }
}

function validateSourceBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new AuthorityOwnershipReviewError("authority_ownership_invalid_bundle", "source_bundle must be an object.");
  }
  if (bundle.contract !== "mad4b.ueacp.authority-evidence-source-bundle.v1") {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_untrusted_bundle",
      "source_bundle must use the canonical evidence-source contract.",
    );
  }
  if (!bundle.inventory || bundle.inventory.contract !== "mad4b.ueacp.authority-path-inventory.v1") {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_untrusted_inventory",
      "source_bundle must contain the canonical authority-path inventory.",
    );
  }
  if (bundle.provider_calls !== false || bundle.credential_payload_read !== false || bundle.external_writes !== false || bundle.secrets_included !== false) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_unsafe_bundle",
      "source_bundle safety markers are not satisfied.",
    );
  }
}

function reviewRequiredObjectNames(catalog, bundle) {
  const catalogNames = new Set(catalog.objects.map((object) => token(object.object_name, "catalog.objects[].object_name")));
  const required = new Set(
    catalog.objects
      .filter((object) => object.ownership_classification && object.ownership_classification !== "unclassified")
      .map((object) => object.object_name),
  );
  const referenceFields = [
    "revision_source",
    "resource_authority_source",
    "capability_authority_source",
    "provider_scope_source",
    "credential_scope_source",
    "revocation_source",
    "invalidation_source",
  ];
  for (const path of bundle.inventory.paths) {
    for (const field of referenceFields) {
      const value = path[field];
      if (value && catalogNames.has(value)) required.add(value);
    }
  }
  return [...required].sort();
}

function normalizeEntry(entry, index, catalogByName, revisionByName) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_entry",
      "Each ownership review entry must be an object.",
      { index },
    );
  }
  assertNoSensitiveValues(entry, `review_entries[${index}]`);
  const objectName = token(entry.object_name, `review_entries[${index}].object_name`);
  if (!catalogByName.has(objectName)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_unknown_object",
      "Ownership review references an object absent from the catalog census.",
      { object_name: objectName },
    );
  }
  const ownershipClass = enumValue(entry.ownership_class, OWNERSHIP_CLASSES, `review_entries[${index}].ownership_class`);
  const revisionStrategy = enumValue(entry.revision_strategy, REVISION_STRATEGIES, `review_entries[${index}].revision_strategy`);
  const approved = boolean(entry.approved, `review_entries[${index}].approved`);
  const evidenceRefs = stringList(entry.evidence_refs, `review_entries[${index}].evidence_refs`, { minItems: 1 });
  const ownerKey = token(entry.owner_key, `review_entries[${index}].owner_key`);
  const sharedOwnerKeys = stringList(entry.shared_owner_keys ?? [], `review_entries[${index}].shared_owner_keys`);
  const rationale = String(entry.rationale ?? "").trim();
  if (rationale.length < 20 || rationale.length > 2000) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_rationale",
      "Ownership review rationale must be between 20 and 2000 characters.",
      { object_name: objectName },
    );
  }

  const observedSupport = revisionByName.get(objectName)?.support || "unknown";
  const authorityObject = AUTHORITY_CLASSES.has(ownershipClass);
  let revisionCompatible = true;
  if (authorityObject && observedSupport === "explicit_revision") revisionCompatible = revisionStrategy === "reuse_explicit_revision";
  else if (authorityObject && observedSupport === "temporal_freshness_only") revisionCompatible = revisionStrategy === "add_explicit_revision";
  else if (authorityObject && observedSupport === "absent") revisionCompatible = revisionStrategy === "add_revision";
  else if (!authorityObject) revisionCompatible = revisionStrategy === "not_applicable" || revisionStrategy === "reuse_explicit_revision";
  else revisionCompatible = false;

  const sharingCompatible = ownershipClass !== "shared_authority"
    ? sharedOwnerKeys.length === 0
    : sharedOwnerKeys.length >= 2 && sharedOwnerKeys.includes(ownerKey);

  return {
    object_name: objectName,
    object_type: catalogByName.get(objectName).object_type,
    ownership_class: ownershipClass,
    owner_key: ownerKey,
    shared_owner_keys: sharedOwnerKeys,
    approved,
    evidence_refs: evidenceRefs,
    rationale,
    observed_revision_support: observedSupport,
    revision_strategy: revisionStrategy,
    revision_compatible: revisionCompatible,
    sharing_compatible: sharingCompatible,
  };
}

export function assessAuthorityOwnershipReview({
  catalog_census: catalog,
  source_bundle: bundle,
  review_entries: reviewEntries,
  review_metadata: reviewMetadata,
} = {}) {
  assertNoSensitiveValues({ catalog, bundle, reviewEntries, reviewMetadata });
  validateCatalog(catalog);
  validateSourceBundle(bundle);
  if (!Array.isArray(reviewEntries)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_entries",
      "review_entries must be an array.",
    );
  }
  if (!reviewMetadata || typeof reviewMetadata !== "object" || Array.isArray(reviewMetadata)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_metadata",
      "review_metadata must be an object.",
    );
  }

  const catalogByName = new Map(catalog.objects.map((object) => [object.object_name, object]));
  const revisionByName = new Map(catalog.revision_support.map((item) => [item.object_name, item]));
  const entries = reviewEntries.map((entry, index) => normalizeEntry(entry, index, catalogByName, revisionByName));
  const duplicateNames = entries
    .map((entry) => entry.object_name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_duplicate_entry",
      "Each catalog object may have one ownership review entry.",
      { object_names: [...new Set(duplicateNames)].sort() },
    );
  }

  const requiredNames = reviewRequiredObjectNames(catalog, bundle);
  const reviewedNames = new Set(entries.map((entry) => entry.object_name));
  const missingObjects = requiredNames.filter((name) => !reviewedNames.has(name));
  const rejectedObjects = entries.filter((entry) => !entry.approved).map((entry) => entry.object_name).sort();
  const revisionMismatches = entries.filter((entry) => !entry.revision_compatible).map((entry) => entry.object_name).sort();
  const sharingMismatches = entries.filter((entry) => !entry.sharing_compatible).map((entry) => entry.object_name).sort();

  const evidenceContext = reviewMetadata.evidence_context;
  if (!evidenceContext || typeof evidenceContext !== "object" || Array.isArray(evidenceContext)) {
    throw new AuthorityOwnershipReviewError(
      "authority_ownership_invalid_evidence_context",
      "review_metadata.evidence_context must be an object.",
    );
  }
  const liveObservation = boolean(evidenceContext.live_observation, "review_metadata.evidence_context.live_observation");
  const sameCycleReadback = boolean(evidenceContext.same_cycle_readback, "review_metadata.evidence_context.same_cycle_readback");
  const environment = token(evidenceContext.environment, "review_metadata.evidence_context.environment");
  const operationRef = token(evidenceContext.operation_ref, "review_metadata.evidence_context.operation_ref");
  const readbackRef = token(evidenceContext.readback_ref, "review_metadata.evidence_context.readback_ref");
  const reviewerKey = token(reviewMetadata.reviewer_key, "review_metadata.reviewer_key");
  const reviewedAt = timestamp(reviewMetadata.reviewed_at, "review_metadata.reviewed_at");
  const catalogSha256 = hash(catalog);
  const sourceBundleSha256 = bundle.bundle_sha256 || hash(bundle);
  const inventorySha256 = bundle.inventory.inventory_sha256 || hash(bundle.inventory);

  const blockingIssues = [];
  if (bundle.status !== "ready_for_ownership_review" || bundle.blocking_gap_count !== 0) blockingIssues.push("source_bundle_not_ready");
  if (!liveObservation) blockingIssues.push("catalog_not_live_observation");
  if (!sameCycleReadback) blockingIssues.push("same_cycle_readback_missing");
  if (missingObjects.length) blockingIssues.push("required_objects_unreviewed");
  if (rejectedObjects.length) blockingIssues.push("ownership_review_rejected");
  if (revisionMismatches.length) blockingIssues.push("revision_strategy_mismatch");
  if (sharingMismatches.length) blockingIssues.push("shared_ownership_contract_invalid");

  const report = {
    contract: "mad4b.ueacp.authority-ownership-review.v1",
    status: blockingIssues.length === 0 ? "ready_for_human_task_closure_review" : "blocked",
    reviewer_key: reviewerKey,
    reviewed_at: reviewedAt,
    evidence_context: {
      environment,
      operation_ref: operationRef,
      readback_ref: readbackRef,
      live_observation: liveObservation,
      same_cycle_readback: sameCycleReadback,
    },
    bindings: {
      catalog_sha256: catalogSha256,
      source_bundle_sha256: sourceBundleSha256,
      inventory_sha256: inventorySha256,
    },
    required_object_names: requiredNames,
    reviewed_object_count: entries.length,
    entries: entries.sort((left, right) => left.object_name.localeCompare(right.object_name)),
    gaps: {
      missing_objects: missingObjects,
      rejected_objects: rejectedObjects,
      revision_mismatches: revisionMismatches,
      sharing_mismatches: sharingMismatches,
      blocking_issues: blockingIssues.sort(),
    },
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      t001_ready_for_human_closure: blockingIssues.length === 0,
      t002_ready_for_human_closure: blockingIssues.length === 0,
      migration_design_input_ready: blockingIssues.length === 0,
      migration_apply_authorized: false,
      reason: blockingIssues.length === 0
        ? "Complete source evidence and live catalog ownership review are bound and internally consistent; explicit task closeout and migration design review remain separate."
        : "Source completeness, live readback, ownership coverage, or revision compatibility gaps remain.",
    },
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  report.review_sha256 = hash(report);
  return deepFreeze(report);
}

export const _testingAuthorityOwnershipReview = {
  hash,
  reviewRequiredObjectNames,
  normalizeEntry,
  assertNoSensitiveValues,
};
