import crypto from "node:crypto";

export const UEACP_DATA_FOUNDATION_OBJECTS = Object.freeze({
  T022: Object.freeze([
    Object.freeze({ logical_name: "resource_nodes", aliases: [] }),
    Object.freeze({ logical_name: "resource_edges", aliases: [] }),
    Object.freeze({ logical_name: "resource_access_grants", aliases: [] }),
    Object.freeze({ logical_name: "resource_restrictions", aliases: [] }),
  ]),
  T023: Object.freeze([
    Object.freeze({ logical_name: "delegation_contexts", aliases: ["delegation_grants"] }),
  ]),
  T024: Object.freeze([
    Object.freeze({ logical_name: "effective_authority_decisions", aliases: ["effective_authority_shadow_decisions"] }),
    Object.freeze({ logical_name: "authority_decision_evidence", aliases: [] }),
    Object.freeze({ logical_name: "authority_projection_snapshots", aliases: [] }),
    Object.freeze({ logical_name: "authority_projection_items", aliases: [] }),
    Object.freeze({ logical_name: "authority_drift_findings", aliases: ["authority_projection_drift_events"] }),
    Object.freeze({ logical_name: "authority_invalidation_events", aliases: [] }),
  ]),
});

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const KNOWN_REVISION_SUPPORT = Object.freeze(new Set(["explicit_revision", "temporal_freshness_only", "absent"]));
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityDataFoundationPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityDataFoundationPlanError";
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

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSortObject(value[key]);
    return result;
  }, {});
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableSortObject(value))).digest("hex");
}

function assertNoSensitiveValues(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityDataFoundationPlanError(
        "authority_data_secret_field_forbidden",
        "Authority data foundation input contains a forbidden secret-bearing value.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function requireToken(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_invalid_token",
      `${fieldName} must be a stable bounded token.`,
      { field: fieldName },
    );
  }
  return normalized;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new AuthorityDataFoundationPlanError("authority_data_invalid_catalog", "catalog_census must be an object.");
  }
  if (catalog.mode !== "read_only_authority_catalog_census" || catalog.read_only !== true || catalog.applies_sql !== false) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_untrusted_catalog",
      "catalog_census must be a read-only Authority Catalog Census report.",
    );
  }
  if (!Array.isArray(catalog.objects) || !Array.isArray(catalog.revision_support)) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_incomplete_catalog",
      "catalog_census must include objects and revision_support arrays.",
    );
  }
  if (catalog.secrets_included !== false || catalog.external_writes !== false) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_unsafe_catalog",
      "catalog_census safety invariants are not satisfied.",
    );
  }
}

function validateInventory(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new AuthorityDataFoundationPlanError("authority_data_invalid_inventory", "path_inventory must be an object.");
  }
  if (inventory.contract !== "mad4b.ueacp.authority-path-inventory.v1" || !Array.isArray(inventory.paths)) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_untrusted_inventory",
      "path_inventory must use the canonical UEACP authority path inventory contract.",
    );
  }
  if (inventory.secrets_included !== false || inventory.external_writes !== false) {
    throw new AuthorityDataFoundationPlanError(
      "authority_data_unsafe_inventory",
      "path_inventory safety invariants are not satisfied.",
    );
  }
}

function mapCatalogObjects(catalog) {
  const byName = new Map();
  for (const object of catalog.objects) {
    const name = requireToken(object.object_name, "catalog.objects[].object_name");
    if (byName.has(name)) {
      throw new AuthorityDataFoundationPlanError(
        "authority_data_duplicate_catalog_object",
        "catalog_census contains a duplicate object name.",
        { object_name: name },
      );
    }
    byName.set(name, object);
  }
  return byName;
}

function resolveLogicalObject(definition, catalogByName) {
  const matches = [definition.logical_name, ...definition.aliases]
    .filter((name) => catalogByName.has(name))
    .sort();
  if (matches.length > 1) {
    return {
      logical_name: definition.logical_name,
      aliases: [...definition.aliases],
      disposition: "ambiguous_existing_objects",
      matched_objects: matches,
      blocking: true,
    };
  }
  if (matches.length === 1) {
    const matched = matches[0];
    const exact = matched === definition.logical_name;
    return {
      logical_name: definition.logical_name,
      aliases: [...definition.aliases],
      disposition: exact ? "reuse_exact_existing_object" : "reuse_alias_candidate_after_contract_review",
      matched_objects: [matched],
      blocking: !exact,
    };
  }
  return {
    logical_name: definition.logical_name,
    aliases: [...definition.aliases],
    disposition: "additive_create_candidate",
    matched_objects: [],
    blocking: false,
  };
}

function revisionDisposition(present, support) {
  if (!present) return "inventory_source_not_mapped_to_catalog_object";
  if (support === "explicit_revision") return "reuse_existing_revision";
  if (support === "temporal_freshness_only") return "add_explicit_revision_candidate_after_owner_review";
  if (support === "absent") return "add_revision_candidate_after_owner_review";
  return "support_unknown";
}

function buildRevisionPlan(catalog, inventory) {
  const revisionByObject = new Map(
    catalog.revision_support.map((item) => [requireToken(item.object_name, "revision_support[].object_name"), item]),
  );
  const catalogNames = new Set(catalog.objects.map((object) => requireToken(object.object_name, "catalog.objects[].object_name")));
  const referencedNames = [...new Set(inventory.paths.map((path) => path.revision_source).filter(Boolean))].sort();

  const referencedSources = referencedNames.map((source) => {
    const supportRow = revisionByObject.get(source) || null;
    const support = supportRow?.support || "unknown";
    const present = catalogNames.has(source);
    return {
      source,
      present_in_catalog: present,
      support,
      explicit_revision_columns: [...(supportRow?.explicit_revision_columns || [])].sort(),
      temporal_freshness_columns: [...(supportRow?.temporal_freshness_columns || [])].sort(),
      disposition: revisionDisposition(present, support),
      requires_migration_candidate: present && ["temporal_freshness_only", "absent"].includes(support),
      blocking: !present || !KNOWN_REVISION_SUPPORT.has(support),
    };
  });

  const authorityCandidates = catalog.revision_support
    .filter((item) => item.requires_authoritative_owner_review)
    .map((item) => ({
      object_name: item.object_name,
      ownership_classification: item.ownership_classification,
      support: item.support,
      explicit_revision_columns: [...(item.explicit_revision_columns || [])].sort(),
      temporal_freshness_columns: [...(item.temporal_freshness_columns || [])].sort(),
      disposition: item.support === "explicit_revision"
        ? "reuse_existing_revision"
        : item.support === "temporal_freshness_only"
          ? "owner_review_then_add_explicit_revision_candidate"
          : item.support === "absent"
            ? "owner_review_then_add_revision_candidate"
            : "support_unknown",
      migration_authorized: false,
    }))
    .sort((left, right) => left.object_name.localeCompare(right.object_name));

  return {
    referenced_sources: referencedSources,
    authority_candidates: authorityCandidates,
    migration_candidate_count: referencedSources.filter((item) => item.requires_migration_candidate).length,
    unresolved_reference_count: referencedSources.filter((item) => item.blocking).length,
  };
}

function buildStorageTaskPlan(taskKey, definitions, catalogByName) {
  const objects = definitions.map((definition) => resolveLogicalObject(definition, catalogByName));
  return {
    task_key: taskKey,
    objects,
    exact_reuse_count: objects.filter((item) => item.disposition === "reuse_exact_existing_object").length,
    alias_review_count: objects.filter((item) => item.disposition === "reuse_alias_candidate_after_contract_review").length,
    additive_create_candidate_count: objects.filter((item) => item.disposition === "additive_create_candidate").length,
    ambiguous_count: objects.filter((item) => item.disposition === "ambiguous_existing_objects").length,
    migration_authorized: false,
  };
}

export function buildAuthorityDataFoundationPlan({ catalog_census: catalog, path_inventory: inventory } = {}) {
  assertNoSensitiveValues({ catalog, inventory });
  validateCatalog(catalog);
  validateInventory(inventory);

  const catalogByName = mapCatalogObjects(catalog);
  const revisionPlan = buildRevisionPlan(catalog, inventory);
  const storageTaskPlans = {
    T022: buildStorageTaskPlan("T022", UEACP_DATA_FOUNDATION_OBJECTS.T022, catalogByName),
    T023: buildStorageTaskPlan("T023", UEACP_DATA_FOUNDATION_OBJECTS.T023, catalogByName),
    T024: buildStorageTaskPlan("T024", UEACP_DATA_FOUNDATION_OBJECTS.T024, catalogByName),
  };

  const blockingIssues = [];
  if (catalog.closure_state?.t002_complete !== true) blockingIssues.push("t002_live_catalog_not_closed");
  if (inventory.closure_state?.t001_complete !== true) blockingIssues.push("t001_authority_path_inventory_not_closed");
  if (revisionPlan.unresolved_reference_count > 0) blockingIssues.push("revision_sources_unresolved_or_unknown");
  for (const taskPlan of Object.values(storageTaskPlans)) {
    if (taskPlan.ambiguous_count > 0) blockingIssues.push(`${taskPlan.task_key.toLowerCase()}_ambiguous_existing_objects`);
    if (taskPlan.alias_review_count > 0) blockingIssues.push(`${taskPlan.task_key.toLowerCase()}_alias_contract_review_required`);
  }

  const migrationBatches = [
    {
      batch_key: "authority_revisions",
      tasks: ["T021"],
      purpose: "Add explicit revisions only to confirmed authority owners that lack them.",
      prerequisites: ["T001", "T002", "owner_classification", "same_cycle_schema_readback"],
      migration_authorized: false,
    },
    {
      batch_key: "resource_graph_and_delegation_storage",
      tasks: ["T022", "T023"],
      purpose: "Reuse or add missing graph, restriction, and delegation storage without duplicate authority stores.",
      prerequisites: ["T001", "T002", "exact_contract_review", "separate_checksum_bound_approval"],
      migration_authorized: false,
    },
    {
      batch_key: "decision_projection_invalidation_drift_ledgers",
      tasks: ["T024"],
      purpose: "Reuse or add bounded no-secret evidence and lifecycle ledgers without enabling writers.",
      prerequisites: ["T001", "T002", "retention_review", "constraint_review", "separate_checksum_bound_approval"],
      migration_authorized: false,
    },
  ];

  const uniqueBlockingIssues = [...new Set(blockingIssues)].sort();
  const report = {
    contract: "mad4b.ueacp.authority-data-foundation-plan.v1",
    status: uniqueBlockingIssues.length === 0 ? "ready_for_migration_design_review" : "blocked_pending_evidence",
    catalog_schema: catalog.schema_name,
    catalog_observed_at: catalog.database_server?.observed_at || null,
    catalog_object_count: catalog.summary?.object_count ?? catalog.objects.length,
    inventory_sha256: inventory.inventory_sha256 || null,
    revision_plan: revisionPlan,
    storage_task_plans: storageTaskPlans,
    migration_batches: migrationBatches,
    blocking_issues: uniqueBlockingIssues,
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      t021_complete: false,
      t022_complete: false,
      t023_complete: false,
      t024_complete: false,
      migration_design_ready_for_human_review: uniqueBlockingIssues.length === 0,
      migration_execution_authorized: false,
      reason: uniqueBlockingIssues.length === 0
        ? "The blueprint is internally consistent, but each migration still requires explicit human review and separate authorization."
        : "Live catalog closure, complete authority inventory, or exact existing-object contract evidence is still missing.",
    },
    runtime_enforcement_enabled: false,
    evidence_persistence_enabled: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  report.plan_sha256 = canonicalHash(report);
  return deepFreeze(report);
}

export const _testingAuthorityDataFoundationPlanner = {
  canonicalHash,
  mapCatalogObjects,
  resolveLogicalObject,
  buildRevisionPlan,
  revisionDisposition,
  assertNoSensitiveValues,
};
