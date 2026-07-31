import fs from "node:fs";
import crypto from "node:crypto";

const baseUrl = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
const backendApiKey = String(process.env.BACKEND_API_KEY || "").trim();
const evidencePath = String(process.env.EVIDENCE_PATH || "").trim();
const repository = String(process.env.REPOSITORY || "").trim();
const observedRef = String(process.env.OBSERVED_REF || "").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function boundedRows(value, name, maximum) {
  const rows = Array.isArray(value) ? value : [];
  assert(rows.length <= maximum, `${name} exceeded bounded maximum ${maximum}.`);
  return rows;
}

function normalizeDbRows(response, queryKey) {
  assert(response?.ok === true, `${queryKey} admin control request failed.`);
  assert(response?.tool === "db", `${queryKey} did not execute through db control.`);
  const result = response?.result;
  assert(result?.statement_result_type === "rows", `${queryKey} was not a read-only row result.`);
  assert(result?.secrets_included === false, `${queryKey} response did not preserve no-secret marker.`);
  return Array.isArray(result.rows) ? result.rows : [];
}

async function adminDbSelect(queryKey, sql, params = []) {
  const normalized = String(sql || "").trim();
  assert(/^(SELECT|WITH|SHOW)\b/i.test(normalized), `${queryKey} is not a read-only SQL statement.`);
  assert(!/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|SET)\b/i.test(normalized), `${queryKey} contains a forbidden mutation token.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}/admin/cli/control`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${backendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool: "db", action: "run", sql: normalized, params }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { non_json_response: true }; }
    assert(response.ok, `${queryKey} failed with HTTP ${response.status}.`);
    return normalizeDbRows(payload, queryKey);
  } finally {
    clearTimeout(timer);
  }
}

assert(baseUrl, "RUNTIME_BASE_URL is required.");
assert(backendApiKey, "BACKEND_API_KEY is required.");
assert(evidencePath, "EVIDENCE_PATH is required.");
assert(repository, "REPOSITORY is required.");
assert(/^[0-9a-f]{40}$/i.test(observedRef), "OBSERVED_REF must be a full commit SHA.");

const startedAt = new Date().toISOString();
const identityRows = await adminDbSelect(
  "database_identity",
  "SELECT DATABASE() AS schema_name, VERSION() AS version, @@version_comment AS version_comment, UTC_TIMESTAMP(6) AS observed_at",
);
assert(identityRows.length === 1, "database_identity must return exactly one row.");
const schemaName = String(identityRows[0]?.schema_name || "").trim();
assert(schemaName, "Live database schema identity is unavailable.");

const objects = boundedRows(await adminDbSelect(
  "schema_objects",
  "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
), "schema_objects", 2048);

const columns = boundedRows(await adminDbSelect(
  "schema_columns",
  "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
), "schema_columns", 32768);

const indexes = boundedRows(await adminDbSelect(
  "schema_indexes",
  "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
), "schema_indexes", 32768);

const foreignKeys = boundedRows(await adminDbSelect(
  "schema_foreign_keys",
  "SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
), "schema_foreign_keys", 16384);

const views = boundedRows(await adminDbSelect(
  "schema_views",
  "SELECT TABLE_SCHEMA, TABLE_NAME, CHECK_OPTION, IS_UPDATABLE, SECURITY_TYPE, SHA2(COALESCE(VIEW_DEFINITION, ''), 256) AS definition_sha256 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
), "schema_views", 2048);

const viewDependencies = boundedRows(await adminDbSelect(
  "view_dependencies",
  "SELECT VIEW_SCHEMA, VIEW_NAME, TABLE_SCHEMA, TABLE_NAME FROM information_schema.VIEW_TABLE_USAGE WHERE VIEW_SCHEMA = DATABASE() ORDER BY VIEW_NAME, TABLE_SCHEMA, TABLE_NAME",
), "view_dependencies", 20000);

const readbackRows = await adminDbSelect(
  "same_cycle_readback",
  "SELECT DATABASE() AS schema_name, UTC_TIMESTAMP(6) AS readback_at, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS object_count, (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()) AS column_count, (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()) AS view_count",
);
assert(readbackRows.length === 1, "same_cycle_readback must return exactly one row.");
const readback = readbackRows[0];
assert(String(readback.schema_name || "").trim() === schemaName, "Same-cycle readback schema identity changed.");
assert(Number(readback.object_count) === objects.length, "Same-cycle object count does not match observation.");
assert(Number(readback.column_count) === columns.length, "Same-cycle column count does not match observation.");
assert(Number(readback.view_count) === views.length, "Same-cycle view count does not match observation.");

const revisionNames = new Set(["revision", "revision_id", "revision_number", "version", "version_id", "version_number", "row_version", "lock_version", "etag"]);
const temporalNames = new Set(["updated_at", "modified_at", "changed_at", "valid_from", "valid_until", "expires_at", "revoked_at"]);
const columnsByObject = new Map();
for (const column of columns) {
  const objectName = String(column.TABLE_NAME || "");
  if (!columnsByObject.has(objectName)) columnsByObject.set(objectName, []);
  columnsByObject.get(objectName).push(String(column.COLUMN_NAME || "").toLowerCase());
}
const revisionSupport = objects
  .filter((object) => String(object.TABLE_TYPE || "").toUpperCase() === "BASE TABLE")
  .map((object) => {
    const objectName = String(object.TABLE_NAME || "");
    const names = columnsByObject.get(objectName) || [];
    const explicit = names.filter((name) => revisionNames.has(name));
    const temporal = names.filter((name) => temporalNames.has(name));
    return {
      object_name: objectName,
      support: explicit.length ? "explicit_revision" : temporal.length ? "temporal_freshness_only" : "absent",
      explicit_revision_columns: explicit,
      temporal_freshness_columns: temporal,
    };
  })
  .sort((left, right) => left.object_name.localeCompare(right.object_name));

const payload = {
  contract: "mad4b.ueacp.live-authority-catalog-observation.v1",
  status: "observed_unclassified",
  repository,
  observed_ref: observedRef.toLowerCase(),
  environment: "production_runtime",
  mode: "read_only_authority_catalog_census",
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  database_server: {
    schema_name: schemaName,
    version: String(identityRows[0]?.version || ""),
    version_comment: String(identityRows[0]?.version_comment || ""),
    observed_at: String(identityRows[0]?.observed_at || ""),
    readback_at: String(readback.readback_at || ""),
  },
  summary: {
    object_count: objects.length,
    base_table_count: objects.filter((item) => String(item.TABLE_TYPE || "").toUpperCase() === "BASE TABLE").length,
    view_count: views.length,
    column_count: columns.length,
    index_column_count: indexes.length,
    foreign_key_count: foreignKeys.length,
    view_dependency_count: viewDependencies.length,
    explicit_revision_table_count: revisionSupport.filter((item) => item.support === "explicit_revision").length,
    temporal_only_table_count: revisionSupport.filter((item) => item.support === "temporal_freshness_only").length,
    absent_revision_table_count: revisionSupport.filter((item) => item.support === "absent").length,
  },
  objects,
  columns,
  indexes,
  foreign_keys: foreignKeys,
  views,
  view_dependencies: viewDependencies,
  revision_support: revisionSupport,
  same_cycle_readback: {
    verified: true,
    schema_name: String(readback.schema_name || ""),
    object_count: Number(readback.object_count),
    column_count: Number(readback.column_count),
    view_count: Number(readback.view_count),
    readback_at: String(readback.readback_at || ""),
  },
  queries_executed: [
    "database_identity",
    "schema_objects",
    "schema_columns",
    "schema_indexes",
    "schema_foreign_keys",
    "schema_views",
    "view_dependencies",
    "same_cycle_readback",
  ],
  closure_state: {
    t002_complete: false,
    ready_for_ownership_classification: true,
    t021_authorized: false,
    migration_apply_authorized: false,
  },
  read_only: true,
  applies_sql: false,
  runtime_authority_changed: false,
  database_mutation_executed: false,
  provider_calls: false,
  credential_payload_read: false,
  external_writes: false,
  secrets_included: false,
};
payload.observation_sha256 = sha256(payload);
fs.writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`AUTHORITY_LIVE_CENSUS_STATUS=${payload.status}`);
console.log(`AUTHORITY_LIVE_CENSUS_SCHEMA=${schemaName}`);
console.log(`AUTHORITY_LIVE_CENSUS_OBJECTS=${objects.length}`);
console.log(`AUTHORITY_LIVE_CENSUS_COLUMNS=${columns.length}`);
console.log(`AUTHORITY_LIVE_CENSUS_VIEWS=${views.length}`);
console.log(`AUTHORITY_LIVE_CENSUS_SHA256=${payload.observation_sha256}`);
