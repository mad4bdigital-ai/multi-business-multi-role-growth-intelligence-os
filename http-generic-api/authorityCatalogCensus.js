import { getPool } from "./db.js";

export const AUTHORITY_CATALOG_LIMITS = Object.freeze({
  maxObjects: 2048,
  maxColumns: 32768,
  maxIndexColumns: 32768,
  maxForeignKeys: 16384,
  maxViews: 2048,
});

const EXPLICIT_REVISION_COLUMNS = Object.freeze(new Set([
  "revision",
  "revision_id",
  "revision_number",
  "version",
  "version_id",
  "version_number",
  "row_version",
  "lock_version",
  "etag",
]));

const TEMPORAL_FRESHNESS_COLUMNS = Object.freeze(new Set([
  "updated_at",
  "modified_at",
  "changed_at",
  "valid_from",
  "valid_until",
  "expires_at",
  "revoked_at",
]));

const AUTHORITY_NAME_TOKENS = Object.freeze([
  "principal",
  "role",
  "membership",
  "assignment",
  "scope",
  "grant",
  "delegation",
  "resource",
  "restriction",
  "capability",
  "policy",
  "connection",
  "endpoint",
  "certification",
  "authority",
  "permission",
  "workspace",
  "tenant",
]);

const EVIDENCE_NAME_TOKENS = Object.freeze([
  "decision",
  "evidence",
  "audit",
  "drift",
  "invalidation",
  "event",
  "snapshot",
  "ledger",
  "log",
]);

export class AuthorityCatalogCensusError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityCatalogCensusError";
    this.code = code;
    this.details = details;
  }
}

function allRows(queryResult) {
  const [rows = []] = queryResult || [];
  return Array.isArray(rows) ? rows : [];
}

function firstRow(queryResult) {
  return allRows(queryResult)[0] || null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function boundedRows(rows, limit, key) {
  if (rows.length > limit) {
    throw new AuthorityCatalogCensusError(
      "authority_catalog_limit_exceeded",
      "Authority catalog census exceeded a configured metadata bound.",
      { key, limit, observed_at_least: rows.length },
    );
  }
  return rows;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function classifyObject({ objectName, objectType }) {
  const name = String(objectName || "").toLowerCase();
  const type = String(objectType || "").toUpperCase();
  if (type === "VIEW" || name.startsWith("v_")) return "derived_projection_candidate";
  if (EVIDENCE_NAME_TOKENS.some((token) => name.includes(token))) return "evidence_ledger_candidate";
  if (AUTHORITY_NAME_TOKENS.some((token) => name.includes(token))) return "authority_source_candidate";
  return "unclassified";
}

function buildRevisionSupport(objects, columns) {
  const columnsByObject = new Map();
  for (const column of columns) {
    const objectName = column.object_name;
    if (!columnsByObject.has(objectName)) columnsByObject.set(objectName, []);
    columnsByObject.get(objectName).push(column);
  }

  return objects
    .filter((object) => object.object_type === "BASE TABLE")
    .map((object) => {
      const objectColumns = columnsByObject.get(object.object_name) || [];
      const explicitRevisionColumns = objectColumns
        .map((column) => column.column_name)
        .filter((name) => EXPLICIT_REVISION_COLUMNS.has(name));
      const temporalFreshnessColumns = objectColumns
        .map((column) => column.column_name)
        .filter((name) => TEMPORAL_FRESHNESS_COLUMNS.has(name));
      const support = explicitRevisionColumns.length > 0
        ? "explicit_revision"
        : temporalFreshnessColumns.length > 0
          ? "temporal_freshness_only"
          : "absent";
      return {
        object_name: object.object_name,
        ownership_classification: object.ownership_classification,
        support,
        explicit_revision_columns: explicitRevisionColumns,
        temporal_freshness_columns: temporalFreshnessColumns,
        requires_authoritative_owner_review: object.ownership_classification !== "unclassified",
      };
    })
    .sort((left, right) => left.object_name.localeCompare(right.object_name));
}

export async function collectAuthorityCatalogCensus({
  pool = getPool(),
  schemaName = null,
  limits = AUTHORITY_CATALOG_LIMITS,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("pool.query must be a function.");
  }

  const queriesExecuted = [];
  async function run(key, sql, params = []) {
    queriesExecuted.push(key);
    return pool.query(sql, params);
  }

  const server = firstRow(await run(
    "database_identity",
    "SELECT DATABASE() AS schema_name, VERSION() AS version, @@version_comment AS version_comment, UTC_TIMESTAMP(6) AS observed_at",
  ));
  const resolvedSchema = normalizeText(schemaName) || normalizeText(server?.schema_name);
  if (!resolvedSchema) {
    throw new AuthorityCatalogCensusError(
      "authority_catalog_schema_unavailable",
      "The active database schema could not be resolved.",
    );
  }

  const rawObjects = boundedRows(allRows(await run(
    "schema_objects",
    `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
      LIMIT ${limits.maxObjects + 1}`,
    [resolvedSchema],
  )), limits.maxObjects, "schema_objects");

  const objects = rawObjects.map((row) => {
    const objectName = normalizeText(row.TABLE_NAME);
    const objectType = String(row.TABLE_TYPE || "").toUpperCase();
    return {
      object_name: objectName,
      object_type: objectType,
      engine: normalizeText(row.ENGINE),
      approximate_rows: normalizeInteger(row.TABLE_ROWS),
      ownership_classification: classifyObject({ objectName, objectType }),
      classification_source: "heuristic_non_authoritative",
    };
  });

  const rawColumns = boundedRows(allRows(await run(
    "schema_columns",
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
            IS_NULLABLE, COLUMN_KEY, EXTRA, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
      LIMIT ${limits.maxColumns + 1}`,
    [resolvedSchema],
  )), limits.maxColumns, "schema_columns");

  const columns = rawColumns.map((row) => ({
    object_name: normalizeText(row.TABLE_NAME),
    column_name: normalizeText(row.COLUMN_NAME)?.toLowerCase() || null,
    ordinal_position: normalizeInteger(row.ORDINAL_POSITION),
    data_type: normalizeText(row.DATA_TYPE)?.toLowerCase() || null,
    column_type: normalizeText(row.COLUMN_TYPE),
    nullable: String(row.IS_NULLABLE || "").toUpperCase() === "YES",
    column_key: normalizeText(row.COLUMN_KEY),
    extra: normalizeText(row.EXTRA),
    collation_name: normalizeText(row.COLLATION_NAME),
  }));

  const rawIndexes = boundedRows(allRows(await run(
    "schema_indexes",
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
            SUB_PART, INDEX_TYPE
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
      LIMIT ${limits.maxIndexColumns + 1}`,
    [resolvedSchema],
  )), limits.maxIndexColumns, "schema_indexes");

  const indexes = rawIndexes.map((row) => ({
    object_name: normalizeText(row.TABLE_NAME),
    index_name: normalizeText(row.INDEX_NAME),
    unique: Number(row.NON_UNIQUE) === 0,
    sequence: normalizeInteger(row.SEQ_IN_INDEX),
    column_name: normalizeText(row.COLUMN_NAME)?.toLowerCase() || null,
    prefix_length: normalizeInteger(row.SUB_PART),
    index_type: normalizeText(row.INDEX_TYPE),
  }));

  const rawForeignKeys = boundedRows(allRows(await run(
    "schema_foreign_keys",
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,
            REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
      LIMIT ${limits.maxForeignKeys + 1}`,
    [resolvedSchema],
  )), limits.maxForeignKeys, "schema_foreign_keys");

  const foreignKeys = rawForeignKeys.map((row) => ({
    constraint_name: normalizeText(row.CONSTRAINT_NAME),
    object_name: normalizeText(row.TABLE_NAME),
    column_name: normalizeText(row.COLUMN_NAME)?.toLowerCase() || null,
    referenced_object_name: normalizeText(row.REFERENCED_TABLE_NAME),
    referenced_column_name: normalizeText(row.REFERENCED_COLUMN_NAME)?.toLowerCase() || null,
  }));

  const rawViews = boundedRows(allRows(await run(
    "schema_views",
    `SELECT TABLE_NAME, CHECK_OPTION, IS_UPDATABLE, SECURITY_TYPE,
            SHA2(COALESCE(VIEW_DEFINITION, ''), 256) AS definition_sha256
       FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
      LIMIT ${limits.maxViews + 1}`,
    [resolvedSchema],
  )), limits.maxViews, "schema_views");

  const views = rawViews.map((row) => ({
    view_name: normalizeText(row.TABLE_NAME),
    check_option: normalizeText(row.CHECK_OPTION),
    updatable: String(row.IS_UPDATABLE || "").toUpperCase() === "YES",
    security_type: normalizeText(row.SECURITY_TYPE),
    definition_sha256: /^[a-f0-9]{64}$/i.test(String(row.definition_sha256 || ""))
      ? String(row.definition_sha256).toLowerCase()
      : null,
    raw_definition_included: false,
  }));

  const revisionSupport = buildRevisionSupport(objects, columns);
  const unresolvedRevisionCandidates = revisionSupport.filter((item) => (
    item.requires_authoritative_owner_review && item.support !== "explicit_revision"
  ));

  const report = {
    ok: true,
    status: "observed_unclassified",
    mode: "read_only_authority_catalog_census",
    read_only: true,
    applies_sql: false,
    schema_name: resolvedSchema,
    database_server: {
      version: normalizeText(server?.version),
      version_comment: normalizeText(server?.version_comment),
      observed_at: normalizeText(server?.observed_at),
    },
    limits: { ...limits },
    summary: {
      object_count: objects.length,
      base_table_count: objects.filter((item) => item.object_type === "BASE TABLE").length,
      view_count: objects.filter((item) => item.object_type === "VIEW").length,
      column_count: columns.length,
      index_column_count: indexes.length,
      foreign_key_count: foreignKeys.length,
      authority_source_candidate_count: objects.filter((item) => item.ownership_classification === "authority_source_candidate").length,
      derived_projection_candidate_count: objects.filter((item) => item.ownership_classification === "derived_projection_candidate").length,
      evidence_ledger_candidate_count: objects.filter((item) => item.ownership_classification === "evidence_ledger_candidate").length,
      explicit_revision_table_count: revisionSupport.filter((item) => item.support === "explicit_revision").length,
      temporal_only_table_count: revisionSupport.filter((item) => item.support === "temporal_freshness_only").length,
      absent_revision_table_count: revisionSupport.filter((item) => item.support === "absent").length,
    },
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
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };

  return deepFreeze(report);
}

export const _testingAuthorityCatalogCensus = {
  allRows,
  firstRow,
  boundedRows,
  classifyObject,
  buildRevisionSupport,
  deepFreeze,
  EXPLICIT_REVISION_COLUMNS,
  TEMPORAL_FRESHNESS_COLUMNS,
};
