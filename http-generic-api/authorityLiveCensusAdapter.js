import crypto from "node:crypto";

const AUTHORITY_NAME_TOKENS = Object.freeze([
  "principal", "role", "membership", "assignment", "scope", "grant", "delegation",
  "resource", "restriction", "capability", "policy", "connection", "endpoint",
  "certification", "authority", "permission", "workspace", "tenant",
]);
const EVIDENCE_NAME_TOKENS = Object.freeze([
  "decision", "evidence", "audit", "drift", "invalidation", "event", "snapshot", "ledger", "log",
]);
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

function requiredArray(value, field) {
  if (!Array.isArray(value)) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_invalid_array",
      `${field} must be an array.`,
      { field },
    );
  }
  return value;
}

function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function integer(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function classifyObject(objectName, objectType) {
  const name = String(objectName || "").toLowerCase();
  const type = String(objectType || "").toUpperCase();
  if (type === "VIEW" || name.startsWith("v_")) return "derived_projection_candidate";
  if (EVIDENCE_NAME_TOKENS.some((token) => name.includes(token))) return "evidence_ledger_candidate";
  if (AUTHORITY_NAME_TOKENS.some((token) => name.includes(token))) return "authority_source_candidate";
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
      "Live census summary counts must match the bounded evidence arrays.",
      { key, expected: actual, observed: summary?.[key] ?? null },
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
  const rawObjects = requiredArray(observation.objects, "objects");
  const rawColumns = requiredArray(observation.columns, "columns");
  const rawIndexes = requiredArray(observation.indexes, "indexes");
  const rawForeignKeys = requiredArray(observation.foreign_keys, "foreign_keys");
  const rawViews = requiredArray(observation.views, "views");
  const rawViewDependencies = requiredArray(observation.view_dependencies, "view_dependencies");
  const rawRevisionSupport = requiredArray(observation.revision_support, "revision_support");

  assertCount(observation.summary, "object_count", rawObjects.length);
  assertCount(observation.summary, "column_count", rawColumns.length);
  assertCount(observation.summary, "view_count", rawViews.length);
  assertCount(observation.summary, "index_column_count", rawIndexes.length);
  assertCount(observation.summary, "foreign_key_count", rawForeignKeys.length);
  assertCount(observation.summary, "view_dependency_count", rawViewDependencies.length);

  const schemaName = text(observation.database_server?.schema_name);
  if (!schemaName || text(observation.same_cycle_readback?.schema_name) !== schemaName) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_schema_readback_mismatch",
      "The observation and same-cycle readback must identify one exact schema.",
    );
  }
  if (
    Number(observation.same_cycle_readback.object_count) !== rawObjects.length
    || Number(observation.same_cycle_readback.column_count) !== rawColumns.length
    || Number(observation.same_cycle_readback.view_count) !== rawViews.length
  ) {
    throw new AuthorityLiveCensusAdapterError(
      "authority_live_census_readback_count_mismatch",
      "Same-cycle readback counts must match the captured catalog arrays.",
    );
  }

  const objects = rawObjects.map((row) => {
    const objectName = text(row.TABLE_NAME);
    const objectType = String(row.TABLE_TYPE || "").toUpperCase();
    return {
      object_name: objectName,
      object_type: objectType,
      engine: text(row.ENGINE),
      approximate_rows: integer(row.TABLE_ROWS),
      ownership_classification: classifyObject(objectName, objectType),
      classification_source: "heuristic_non_authoritative",
    };
  }).sort((left, right) => left.object_name.localeCompare(right.object_name));
  const classificationByName = new Map(objects.map((object) => [object.object_name, object.ownership_classification]));

  const columns = rawColumns.map((row) => ({
    object_name: text(row.TABLE_NAME),
    column_name: text(row.COLUMN_NAME),
    ordinal_position: integer(row.ORDINAL_POSITION),
    data_type: text(row.DATA_TYPE),
    column_type: text(row.COLUMN_TYPE),
    is_nullable: String(row.IS_NULLABLE || "").toUpperCase() === "YES",
    column_default_present: row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== undefined,
    column_key: text(row.COLUMN_KEY),
    extra: text(row.EXTRA),
    collation_name: text(row.COLLATION_NAME),
  }));
  const indexes = rawIndexes.map((row) => ({
    object_name: text(row.TABLE_NAME),
    index_name: text(row.INDEX_NAME),
    non_unique: Number(row.NON_UNIQUE) === 1,
    sequence: integer(row.SEQ_IN_INDEX),
    column_name: text(row.COLUMN_NAME),
    prefix_length: integer(row.SUB_PART),
    index_type: text(row.INDEX_TYPE),
  }));
  const foreignKeys = rawForeignKeys.map((row) => ({
    constraint_name: text(row.CONSTRAINT_NAME),
    object_name: text(row.TABLE_NAME),
    column_name: text(row.COLUMN_NAME),
    ordinal_position: integer(row.ORDINAL_POSITION),
    referenced_schema: text(row.REFERENCED_TABLE_SCHEMA),
    referenced_object: text(row.REFERENCED_TABLE_NAME),
    referenced_column: text(row.REFERENCED_COLUMN_NAME),
  }));
  const views = rawViews.map((row) => ({
    object_name: text(row.TABLE_NAME),
    check_option: text(row.CHECK_OPTION),
    is_updatable: String(row.IS_UPDATABLE || "").toUpperCase() === "YES",
    security_type: text(row.SECURITY_TYPE),
    definition_sha256: text(row.definition_sha256 ?? row.DEFINITION_SHA256),
  }));
  const viewDependencies = rawViewDependencies.map((row) => ({
    view_schema: text(row.VIEW_SCHEMA),
    view_name: text(row.VIEW_NAME),
    referenced_schema: text(row.TABLE_SCHEMA),
    referenced_object: text(row.TABLE_NAME),
  }));
  const revisionSupport = rawRevisionSupport.map((item) => ({
    object_name: text(item.object_name),
    ownership_classification: classificationByName.get(text(item.object_name)) || "unclassified",
    support: text(item.support),
    explicit_revision_columns: requiredArray(item.explicit_revision_columns, "revision_support[].explicit_revision_columns").map(text),
    temporal_freshness_columns: requiredArray(item.temporal_freshness_columns, "revision_support[].temporal_freshness_columns").map(text),
    requires_authoritative_owner_review: (classificationByName.get(text(item.object_name)) || "unclassified") !== "unclassified",
  })).sort((left, right) => left.object_name.localeCompare(right.object_name));

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
      observed_at: text(observation.database_server?.observed_at),
      readback_at: text(observation.database_server?.readback_at ?? observation.same_cycle_readback?.readback_at),
    },
    summary: { ...observation.summary },
    objects,
    columns,
    indexes,
    foreign_keys: foreignKeys,
    views,
    view_dependencies: viewDependencies,
    revision_support: revisionSupport,
    same_cycle_readback: { ...observation.same_cycle_readback },
    queries_executed: [...requiredArray(observation.queries_executed, "queries_executed")],
    live_observation: {
      repository: text(observation.repository),
      observed_ref: text(observation.observed_ref),
      environment: text(observation.environment),
      started_at: text(observation.started_at),
      completed_at: text(observation.completed_at),
      observation_sha256: observationSha256,
    },
    closure_state: {
      t002_complete: false,
      ready_for_ownership_classification: true,
      t021_authorized: false,
      migration_apply_authorized: false,
    },
    runtime_authority_changed: false,
    database_mutation_executed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  });
}

export const _testingAuthorityLiveCensusAdapter = {
  sha256,
  classifyObject,
  verifyObservationHash,
  assertNoSensitiveValues,
};
