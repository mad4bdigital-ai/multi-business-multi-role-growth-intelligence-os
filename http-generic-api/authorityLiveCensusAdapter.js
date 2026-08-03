import crypto from "node:crypto";

import { AUTHORITY_CATALOG_LIMITS } from "./authorityCatalogCensus.js";

const AUTHORITY_NAME_TOKENS = Object.freeze([
  "principal", "role", "membership", "assignment", "scope", "grant", "delegation",
  "resource", "restriction", "capability", "policy", "connection", "endpoint",
  "certification", "authority", "permission", "workspace", "tenant",
]);
const EVIDENCE_NAME_TOKENS = Object.freeze([
  "decision", "evidence", "audit", "drift", "invalidation", "event", "snapshot", "ledger", "log",
]);
const EXPLICIT_REVISION_COLUMNS = Object.freeze(new Set([
  "revision", "revision_id", "revision_number", "version", "version_id",
  "version_number", "row_version", "lock_version", "etag",
]));
const TEMPORAL_FRESHNESS_COLUMNS = Object.freeze(new Set([
  "updated_at", "modified_at", "changed_at", "valid_from", "valid_until",
  "expires_at", "revoked_at",
]));
const REQUIRED_QUERIES = Object.freeze([
  "database_identity",
  "schema_objects",
  "schema_columns",
  "schema_indexes",
  "schema_foreign_keys",
  "schema_views",
  "view_dependencies",
  "same_cycle_readback",
]);
const MAX_VIEW_DEPENDENCIES = 20_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityLiveCensusAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityLiveCensusAdapterError";
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertNoSensitiveValues(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityLiveCensusAdapterError(
        "authority_live_census_sensitive_value_forbidden",
        "Live census evidence must not contain secret-bearing values.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function requiredArray(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_invalid_array",
      `${field} must be an array.`,
      { field },
    );
  }
  if (value.length > maximum) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_limit_exceeded",
      `${field} exceeds the canonical bounded maximum.`,
      { field, maximum, observed: value.length },
    );
  }
  return value;
}

function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_required_text_missing",
      `${field} is required.`,
      { field },
    );
  }
  return normalized;
}

function integer(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function semanticTokenForms(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) return new Set();
  const forms = new Set([normalized, `${normalized}s`, `${normalized}es`]);
  if (/[^aeiou]y$/.test(normalized)) forms.add(`${normalized.slice(0, -1)}ies`);
  return forms;
}

function hasSemanticToken(name, token) {
  const forms = semanticTokenForms(token);
  return String(name || "")
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean)
    .some((segment) => forms.has(segment));
}

function classifyObject(objectName, objectType) {
  const name = String(objectName || "").toLowerCase();
  const type = String(objectType || "").toUpperCase();
  if (type === "VIEW" || name.startsWith("v_")) return "derived_projection_candidate";
  if (EVIDENCE_NAME_TOKENS.some((token) => hasSemanticToken(name, token))) return "evidence_ledger_candidate";
  if (AUTHORITY_NAME_TOKENS.some((token) => hasSemanticToken(name, token))) return "authority_source_candidate";
  return "unclassified";
}

function verifyObservationHash(observation) {
  const declared = String(observation.observation_sha256 ?? "").toLowerCase();
  if (!HASH_PATTERN.test(declared)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_invalid_hash",
      "observation_sha256 must be a lowercase SHA-256 digest.",
    );
  }
  const { observation_sha256: _ignored, ...unsigned } = observation;
  const computed = sha256(unsigned);
  if (computed !== declared) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_stale_hash",
      "The live census artifact changed after its hash was computed.",
    );
  }
  return declared;
}

function assertCount(summary, key, actual) {
  const observed = Number(summary?.[key]);
  if (!Number.isSafeInteger(observed) || observed !== actual) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_count_mismatch",
      "Live census summary counts must match the bounded evidence arrays and derived classifications.",
      { key, expected: actual, observed: summary?.[key] ?? null },
    );
  }
}

function assertUnique(items, field, selector) {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  }
  if (duplicates.length) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_duplicate_record",
      `${field} contains duplicate records.`,
      { field, keys: [...new Set(duplicates)].sort() },
    );
  }
}

function normalizeQueries(value) {
  const queries = requiredArray(value, "queries_executed", REQUIRED_QUERIES.length)
    .map((item, index) => requiredText(item, `queries_executed[${index}]`));
  const unique = [...new Set(queries)].sort();
  const required = [...REQUIRED_QUERIES].sort();
  if (queries.length !== required.length || JSON.stringify(unique) !== JSON.stringify(required)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_incomplete_query_contract",
      "The live census must execute exactly the eight canonical read-only observation queries.",
      { expected: required, observed: unique },
    );
  }
  return queries;
}

function canonicalRevisionSupport(objects, columns) {
  const columnsByObject = new Map();
  for (const column of columns) {
    if (!columnsByObject.has(column.object_name)) columnsByObject.set(column.object_name, []);
    columnsByObject.get(column.object_name).push(column.column_name);
  }
  return objects
    .filter((object) => object.object_type === "BASE TABLE")
    .map((object) => {
      const names = columnsByObject.get(object.object_name) || [];
      const explicit = names.filter((name) => EXPLICIT_REVISION_COLUMNS.has(name));
      const temporal = names.filter((name) => TEMPORAL_FRESHNESS_COLUMNS.has(name));
      return {
        object_name: object.object_name,
        ownership_classification: object.ownership_classification,
        support: explicit.length ? "explicit_revision" : temporal.length ? "temporal_freshness_only" : "absent",
        explicit_revision_columns: explicit,
        temporal_freshness_columns: temporal,
        requires_authoritative_owner_review: object.ownership_classification !== "unclassified",
      };
    })
    .sort((left, right) => left.object_name.localeCompare(right.object_name));
}

function verifyDeclaredRevisionSupport(rawRevisionSupport, canonical) {
  const normalized = rawRevisionSupport.map((item, index) => ({
    object_name: requiredText(item?.object_name, `revision_support[${index}].object_name`),
    support: requiredText(item?.support, `revision_support[${index}].support`),
    explicit_revision_columns: requiredArray(item?.explicit_revision_columns, `revision_support[${index}].explicit_revision_columns`)
      .map((name) => requiredText(name, `revision_support[${index}].explicit_revision_columns[]`).toLowerCase()),
    temporal_freshness_columns: requiredArray(item?.temporal_freshness_columns, `revision_support[${index}].temporal_freshness_columns`)
      .map((name) => requiredText(name, `revision_support[${index}].temporal_freshness_columns[]`).toLowerCase()),
  })).sort((left, right) => left.object_name.localeCompare(right.object_name));
  const projectedCanonical = canonical.map((item) => ({
    object_name: item.object_name,
    support: item.support,
    explicit_revision_columns: item.explicit_revision_columns,
    temporal_freshness_columns: item.temporal_freshness_columns,
  }));
  if (sha256(normalized) !== sha256(projectedCanonical)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_revision_support_mismatch",
      "Declared revision support does not match the canonical derivation from observed columns.",
    );
  }
}

export function adaptAuthorityLiveCensusObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_invalid_observation",
      "A live authority census observation object is required.",
    );
  }
  assertNoSensitiveValues(observation);
  if (observation.contract !== "mad4b.ueacp.live-authority-catalog-observation.v1") {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_invalid_contract",
      "The canonical live authority catalog observation contract is required.",
    );
  }
  if (
    observation.status !== "observed_unclassified"
    || observation.mode !== "read_only_authority_catalog_census"
    || observation.read_only !== true
    || observation.applies_sql !== false
    || observation.database_mutation_executed !== false
    || observation.provider_calls !== false
    || observation.credential_payload_read !== false
    || observation.external_writes !== false
    || observation.secrets_included !== false
  ) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_unsafe_observation",
      "The live census artifact must preserve successful read-only/no-effect/no-secret markers.",
    );
  }
  if (observation.same_cycle_readback?.verified !== true) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_readback_missing",
      "Verified same-cycle readback evidence is required.",
    );
  }

  const observationSha256 = verifyObservationHash(observation);
  const rawObjects = requiredArray(observation.objects, "objects", AUTHORITY_CATALOG_LIMITS.maxObjects);
  const rawColumns = requiredArray(observation.columns, "columns", AUTHORITY_CATALOG_LIMITS.maxColumns);
  const rawIndexes = requiredArray(observation.indexes, "indexes", AUTHORITY_CATALOG_LIMITS.maxIndexColumns);
  const rawForeignKeys = requiredArray(observation.foreign_keys, "foreign_keys", AUTHORITY_CATALOG_LIMITS.maxForeignKeys);
  const rawViews = requiredArray(observation.views, "views", AUTHORITY_CATALOG_LIMITS.maxViews);
  const rawViewDependencies = requiredArray(observation.view_dependencies, "view_dependencies", MAX_VIEW_DEPENDENCIES);
  const rawRevisionSupport = requiredArray(observation.revision_support, "revision_support", AUTHORITY_CATALOG_LIMITS.maxObjects);
  const queriesExecuted = normalizeQueries(observation.queries_executed);

  if (rawColumns.some((row) => Object.prototype.hasOwnProperty.call(row || {}, "COLUMN_DEFAULT"))) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_raw_column_default_forbidden",
      "Raw column defaults are outside the canonical no-secret census contract.",
    );
  }

  const schemaName = requiredText(observation.database_server?.schema_name, "database_server.schema_name");
  if (requiredText(observation.same_cycle_readback?.schema_name, "same_cycle_readback.schema_name") !== schemaName) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_schema_readback_mismatch",
      "The observation and same-cycle readback must identify one exact schema.",
    );
  }

  const objects = rawObjects.map((row, index) => {
    const objectName = requiredText(row?.TABLE_NAME, `objects[${index}].TABLE_NAME`);
    const objectType = requiredText(row?.TABLE_TYPE, `objects[${index}].TABLE_TYPE`).toUpperCase();
    if (!new Set(["BASE TABLE", "VIEW"]).has(objectType)) {
      throw new AuthorityLiveCensusAdapterError(
        "authority_live_census_invalid_object_type",
        "Catalog objects must be base tables or views.",
        { object_name: objectName, object_type: objectType },
      );
    }
    return {
      object_name: objectName,
      object_type: objectType,
      engine: text(row.ENGINE),
      approximate_rows: integer(row.TABLE_ROWS),
      ownership_classification: classifyObject(objectName, objectType),
      classification_source: "heuristic_non_authoritative",
    };
  }).sort((left, right) => left.object_name.localeCompare(right.object_name));
  assertUnique(objects, "objects", (item) => item.object_name);

  const columns = rawColumns.map((row, index) => ({
    object_name: requiredText(row?.TABLE_NAME, `columns[${index}].TABLE_NAME`),
    column_name: requiredText(row?.COLUMN_NAME, `columns[${index}].COLUMN_NAME`).toLowerCase(),
    ordinal_position: integer(row?.ORDINAL_POSITION),
    data_type: requiredText(row?.DATA_TYPE, `columns[${index}].DATA_TYPE`).toLowerCase(),
    column_type: text(row?.COLUMN_TYPE),
    nullable: String(row?.IS_NULLABLE || "").toUpperCase() === "YES",
    column_key: text(row?.COLUMN_KEY),
    extra: text(row?.EXTRA),
    collation_name: text(row?.COLLATION_NAME),
  }));
  assertUnique(columns, "columns", (item) => `${item.object_name}:${item.column_name}`);

  const indexes = rawIndexes.map((row, index) => ({
    object_name: requiredText(row?.TABLE_NAME, `indexes[${index}].TABLE_NAME`),
    index_name: requiredText(row?.INDEX_NAME, `indexes[${index}].INDEX_NAME`),
    unique: Number(row?.NON_UNIQUE) === 0,
    sequence: integer(row?.SEQ_IN_INDEX),
    column_name: requiredText(row?.COLUMN_NAME, `indexes[${index}].COLUMN_NAME`).toLowerCase(),
    prefix_length: integer(row?.SUB_PART),
    index_type: text(row?.INDEX_TYPE),
  }));
  assertUnique(indexes, "indexes", (item) => `${item.object_name}:${item.index_name}:${item.sequence}`);

  const foreignKeys = rawForeignKeys.map((row, index) => ({
    constraint_name: requiredText(row?.CONSTRAINT_NAME, `foreign_keys[${index}].CONSTRAINT_NAME`),
    object_name: requiredText(row?.TABLE_NAME, `foreign_keys[${index}].TABLE_NAME`),
    column_name: requiredText(row?.COLUMN_NAME, `foreign_keys[${index}].COLUMN_NAME`).toLowerCase(),
    referenced_object_name: requiredText(row?.REFERENCED_TABLE_NAME, `foreign_keys[${index}].REFERENCED_TABLE_NAME`),
    referenced_column_name: requiredText(row?.REFERENCED_COLUMN_NAME, `foreign_keys[${index}].REFERENCED_COLUMN_NAME`).toLowerCase(),
  }));
  assertUnique(foreignKeys, "foreign_keys", (item) => `${item.object_name}:${item.constraint_name}:${item.column_name}`);

  const views = rawViews.map((row, index) => {
    const definitionSha256 = String(row?.definition_sha256 ?? row?.DEFINITION_SHA256 ?? "").toLowerCase();
    if (!HASH_PATTERN.test(definitionSha256)) {
      throw new AuthorityLiveCensusAdapterError(
        "authority_live_census_invalid_view_hash",
        "Every view must expose a valid hashed definition and never a raw definition.",
        { index },
      );
    }
    return {
      view_name: requiredText(row?.TABLE_NAME, `views[${index}].TABLE_NAME`),
      check_option: text(row?.CHECK_OPTION),
      updatable: String(row?.IS_UPDATABLE || "").toUpperCase() === "YES",
      security_type: text(row?.SECURITY_TYPE),
      definition_sha256: definitionSha256,
      raw_definition_included: false,
    };
  }).sort((left, right) => left.view_name.localeCompare(right.view_name));
  assertUnique(views, "views", (item) => item.view_name);

  const viewDependencies = rawViewDependencies.map((row, index) => ({
    view_schema: requiredText(row?.VIEW_SCHEMA, `view_dependencies[${index}].VIEW_SCHEMA`),
    view_name: requiredText(row?.VIEW_NAME, `view_dependencies[${index}].VIEW_NAME`),
    referenced_schema: requiredText(row?.TABLE_SCHEMA, `view_dependencies[${index}].TABLE_SCHEMA`),
    referenced_object: requiredText(row?.TABLE_NAME, `view_dependencies[${index}].TABLE_NAME`),
  }));
  assertUnique(viewDependencies, "view_dependencies", (item) => (
    `${item.view_schema}:${item.view_name}:${item.referenced_schema}:${item.referenced_object}`
  ));

  const revisionSupport = canonicalRevisionSupport(objects, columns);
  verifyDeclaredRevisionSupport(rawRevisionSupport, revisionSupport);
  const unresolvedRevisionCandidates = revisionSupport.filter((item) => (
    item.requires_authoritative_owner_review && item.support !== "explicit_revision"
  ));

  assertCount(observation.summary, "object_count", objects.length);
  assertCount(observation.summary, "base_table_count", objects.filter((item) => item.object_type === "BASE TABLE").length);
  assertCount(observation.summary, "view_count", views.length);
  assertCount(observation.summary, "column_count", columns.length);
  assertCount(observation.summary, "index_column_count", indexes.length);
  assertCount(observation.summary, "foreign_key_count", foreignKeys.length);
  assertCount(observation.summary, "view_dependency_count", viewDependencies.length);
  assertCount(observation.summary, "explicit_revision_table_count", revisionSupport.filter((item) => item.support === "explicit_revision").length);
  assertCount(observation.summary, "temporal_only_table_count", revisionSupport.filter((item) => item.support === "temporal_freshness_only").length);
  assertCount(observation.summary, "absent_revision_table_count", revisionSupport.filter((item) => item.support === "absent").length);

  if (
    Number(observation.same_cycle_readback.object_count) !== objects.length
    || Number(observation.same_cycle_readback.column_count) !== columns.length
    || Number(observation.same_cycle_readback.view_count) !== views.length
  ) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_readback_count_mismatch",
      "Same-cycle readback counts must match the captured catalog arrays.",
    );
  }

  const summary = {
    object_count: objects.length,
    base_table_count: objects.filter((item) => item.object_type === "BASE TABLE").length,
    view_count: views.length,
    column_count: columns.length,
    index_column_count: indexes.length,
    foreign_key_count: foreignKeys.length,
    authority_source_candidate_count: objects.filter((item) => item.ownership_classification === "authority_source_candidate").length,
    derived_projection_candidate_count: objects.filter((item) => item.ownership_classification === "derived_projection_candidate").length,
    evidence_ledger_candidate_count: objects.filter((item) => item.ownership_classification === "evidence_ledger_candidate").length,
    explicit_revision_table_count: revisionSupport.filter((item) => item.support === "explicit_revision").length,
    temporal_only_table_count: revisionSupport.filter((item) => item.support === "temporal_freshness_only").length,
    absent_revision_table_count: revisionSupport.filter((item) => item.support === "absent").length,
  };

  return deepFreeze({
    ok: true,
    status: "observed_unclassified",
    mode: "read_only_authority_catalog_census",
    read_only: true,
    applies_sql: false,
    schema_name: schemaName,
    database_server: {
      version: text(observation.database_server?.version),
      version_comment: text(observation.database_server?.version_comment),
      observed_at: requiredText(observation.database_server?.observed_at, "database_server.observed_at"),
    },
    limits: { ...AUTHORITY_CATALOG_LIMITS },
    summary,
    objects,
    columns,
    indexes,
    foreign_keys: foreignKeys,
    views,
    revision_support: revisionSupport,
    unresolved_revision_candidates: unresolvedRevisionCandidates,
    closure_state: {
      t002_complete: false,
      t021_authorized: false,
      reason: "Human authority ownership classification and same-cycle live readback are still required before revision migrations are designed or applied.",
    },
    queries_executed: queriesExecuted,
    live_observation: {
      repository: requiredText(observation.repository, "repository"),
      observed_ref: requiredText(observation.observed_ref, "observed_ref"),
      environment: requiredText(observation.environment, "environment"),
      started_at: requiredText(observation.started_at, "started_at"),
      completed_at: requiredText(observation.completed_at, "completed_at"),
      readback_at: requiredText(observation.same_cycle_readback?.readback_at, "same_cycle_readback.readback_at"),
      same_cycle_readback_verified: true,
      view_dependency_count: viewDependencies.length,
      view_dependencies_sha256: sha256(viewDependencies),
      observation_sha256: observationSha256,
    },
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  });
}

export const _testingAuthorityLiveCensusAdapter = {
  sha256,
  hasSemanticToken,
  classifyObject,
  verifyObservationHash,
  canonicalRevisionSupport,
  assertNoSensitiveValues,
};
