import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

const configBytes = fs.readFileSync(new URL("./config/staging-runtime-registry-reconciliation.json", import.meta.url));
const artifactRegistryBytes = fs.readFileSync(new URL("./config/canonical-semantic-artifacts.json", import.meta.url));
const migrationManifestBytes = fs.readFileSync(new URL("./config/staging-database-role-migration-manifest.json", import.meta.url));
const CONFIG = Object.freeze(JSON.parse(configBytes.toString("utf8")));
const artifactRegistry = JSON.parse(artifactRegistryBytes.toString("utf8"));
const ARTIFACT = artifactRegistry.artifacts.find((item) => item.artifact_key === CONFIG.source_artifact_key);
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/u;
const TICK = String.fromCharCode(96);
const PLAN_KEYS = Object.freeze([
  "contract","plan_schema_version","expected_repository","expected_commit","target_environment","target_role",
  "reconciliation_contract_sha256","artifact_registry_sha256","migration_manifest_sha256","source_artifact",
  "precondition_fingerprint","status_before","repair_allowed","missing_count","exact_count","conflict_count","extra_count",
  "missing_statement_sha256","same_cycle_readback_required","insertion_only","updates_allowed","deletes_allowed",
  "caller_sql_forbidden","caller_target_forbidden","production_access_forbidden","provider_access_forbidden",
  "schema_prerequisites","repair_generation","supersedes_plan_sha256","reconciliation_evidence_hash","previous_outcome"
]);

export const STAGING_RUNTIME_REGISTRY_RECONCILIATION_CONFIG = CONFIG;
export const STAGING_RUNTIME_REGISTRY_RECONCILIATION_REPOSITORY = REPOSITORY;

function fail(code, message, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.secrets_included = false;
  if (details) error.details = details;
  throw error;
}
export function registrySha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
export function registryFingerprint(value) {
  return registrySha256(JSON.stringify(stable(value)));
}
function clean(value) { return String(value ?? "").trim(); }
function requireSha40(value, field) {
  const normalized = clean(value).toLowerCase();
  if (!SHA40.test(normalized)) fail("STAGING_REGISTRY_RECONCILIATION_SHA_INVALID", field + " must be a 40-character SHA.");
  return normalized;
}
function requireDigest(value, field) {
  const normalized = clean(value).toLowerCase();
  if (!SHA256.test(normalized)) fail("STAGING_REGISTRY_RECONCILIATION_DIGEST_INVALID", field + " must be SHA-256.");
  return normalized;
}
function quoteIdentifier(value) {
  const name = clean(value);
  if (!SAFE_IDENTIFIER.test(name)) fail("STAGING_REGISTRY_RECONCILIATION_IDENTIFIER_INVALID", "Unsafe registry SQL identifier.");
  return TICK + name + TICK;
}
export function registryRequiredConfirmation(planSha) {
  return "RECONCILE_STAGING_RUNTIME_REGISTRY_" + String(planSha).slice(0, 12).toUpperCase();
}
function rowsFromResult(result) {
  if (Array.isArray(result?.[0])) return result[0];
  return Array.isArray(result) ? result : [];
}
async function queryRows(executor, sql, params = []) {
  return rowsFromResult(await executor.query(sql, params));
}
const READ_ACCESS_ERROR_CODES = new Set([
  "ER_DBACCESS_DENIED_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_COLUMNACCESS_DENIED_ERROR",
]);
const READ_ACCESS_ERRNOS = new Set([1044, 1142, 1143]);
export function classifyStagingRuntimeRegistryReadAccessError(error = {}) {
  const code = String(error?.code || "").trim().toUpperCase();
  const errno = Number(error?.errno);
  const message = String(error?.message || "").trim();
  const denied = READ_ACCESS_ERROR_CODES.has(code)
    || READ_ACCESS_ERRNOS.has(errno)
    || /\bSELECT command denied\b/iu.test(message);
  if (!denied) return null;
  const causeCode = READ_ACCESS_ERROR_CODES.has(code)
    ? code
    : READ_ACCESS_ERRNOS.has(errno)
      ? `MYSQL_${errno}`
      : "SELECT_COMMAND_DENIED";
  return Object.freeze({
    reason: "runtime_registry_select_denied",
    cause_code: causeCode,
    secrets_included: false,
  });
}
async function preflightRegistryReadAccess(executor) {
  for (const entry of CONFIG.tables) {
    try {
      await executor.query("SELECT 1 FROM " + quoteIdentifier(entry.table) + " LIMIT 0");
    } catch (error) {
      if (classifyStagingRuntimeRegistryReadAccessError(error)) throw error;
      const code = String(error?.code || "").trim().toUpperCase();
      const errno = Number(error?.errno);
      if (code === "ER_NO_SUCH_TABLE" || errno === 1146) continue;
      throw error;
    }
  }
}
function stripLeadingComments(value) {
  let source = String(value || "").trim();
  for (;;) {
    const next = source.replace(/^--[^\n]*(?:\n|$)/u, "").replace(/^\/\*[\s\S]*?\*\//u, "").trim();
    if (next === source) return source;
    source = next;
  }
}
function parenthesized(source, start) {
  let index = start;
  while (/\s/u.test(source[index] || "")) index += 1;
  if (source[index] !== "(") return null;
  let depth = 0;
  let quote = null;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const current = source[cursor];
    const next = source[cursor + 1] || "";
    if (quote) {
      if (current === "\\") { cursor += 1; continue; }
      if (current === quote) {
        if (next === quote) cursor += 1;
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === TICK) { quote = current; continue; }
    if (current === "(") depth += 1;
    else if (current === ")" && --depth === 0) return { content: source.slice(index + 1, cursor), end: cursor + 1 };
  }
  return null;
}
function splitTopLevel(value) {
  const out = [];
  let buffer = "";
  let quote = null;
  let depth = 0;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] || "";
    if (quote) {
      buffer += current;
      if (current === "\\") { buffer += next; index += 1; continue; }
      if (current === quote) {
        if (next === quote) { buffer += next; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === TICK) { quote = current; buffer += current; continue; }
    if (current === "(") depth += 1;
    else if (current === ")") depth -= 1;
    if (current === "," && depth === 0) { out.push(buffer.trim()); buffer = ""; }
    else buffer += current;
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
function decodeQuoted(value) {
  const source = String(value);
  const quote = source[0];
  if ((quote !== "'" && quote !== '"') || source[source.length - 1] !== quote) fail("STAGING_REGISTRY_RECONCILIATION_LITERAL_INVALID", "Malformed SQL string literal.");
  let out = "";
  for (let index = 1; index < source.length - 1; index += 1) {
    const current = source[index];
    const next = source[index + 1] || "";
    if (current === quote && next === quote) { out += quote; index += 1; continue; }
    if (current !== "\\") { out += current; continue; }
    index += 1;
    const escaped = source[index] || "";
    if (escaped === "0") out += String.fromCharCode(0);
    else if (escaped === "b") out += String.fromCharCode(8);
    else if (escaped === "n") out += "\n";
    else if (escaped === "r") out += "\r";
    else if (escaped === "t") out += "\t";
    else if (escaped === "Z") out += String.fromCharCode(26);
    else out += escaped;
  }
  return out;
}
function decodeLiteral(value) {
  const source = clean(value);
  if (/^NULL$/iu.test(source)) return null;
  if (/^0x[0-9a-f]+$/iu.test(source)) return Buffer.from(source.slice(2), "hex");
  if ((source.startsWith("'") && source.endsWith("'")) || (source.startsWith('"') && source.endsWith('"'))) return decodeQuoted(source);
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(source)) return source;
  fail("STAGING_REGISTRY_RECONCILIATION_LITERAL_UNSUPPORTED", "Snapshot contains a non-literal SQL value.");
}
function parseInsert(statement) {
  const source = stripLeadingComments(statement).replace(/;\s*$/u, "").trim();
  const prefix = source.match(/^INSERT\s+INTO\s+/iu);
  if (!prefix) fail("STAGING_REGISTRY_RECONCILIATION_STATEMENT_FORBIDDEN", "Registry snapshot may contain INSERT statements only.");
  let cursor = prefix[0].length;
  let table = "";
  if (source[cursor] === TICK) {
    const end = source.indexOf(TICK, cursor + 1);
    if (end < 0) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_INVALID", "Quoted table name is malformed.");
    table = source.slice(cursor + 1, end);
    cursor = end + 1;
  } else {
    const match = source.slice(cursor).match(/^([A-Za-z0-9_]+)/u);
    if (!match) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_INVALID", "Table name is malformed.");
    table = match[1];
    cursor += match[0].length;
  }
  const columnsBlock = parenthesized(source, cursor);
  if (!columnsBlock) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_INVALID", "Snapshot INSERT has no complete column list.");
  const columns = splitTopLevel(columnsBlock.content).map((column) => column.replaceAll(TICK, "").trim());
  if (!columns.length || columns.some((column) => !SAFE_IDENTIFIER.test(column)) || new Set(columns).size !== columns.length) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_COLUMNS_INVALID", "Snapshot INSERT columns are invalid.");
  const valuesPrefix = source.slice(columnsBlock.end).match(/^\s*VALUES\b/iu);
  if (!valuesPrefix) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_INVALID", "Snapshot INSERT must use VALUES.");
  const valuesBlock = parenthesized(source, columnsBlock.end + valuesPrefix[0].length);
  if (!valuesBlock || source.slice(valuesBlock.end).trim()) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_INVALID", "Snapshot INSERT must contain exactly one VALUES row.");
  const rawValues = splitTopLevel(valuesBlock.content);
  if (rawValues.length !== columns.length) fail("STAGING_REGISTRY_RECONCILIATION_INSERT_ARITY", "Snapshot INSERT arity is invalid.");
  return { table, columns, values: rawValues.map(decodeLiteral), statement: source + ";" };
}
function normalizeTemporal(value, dataType) {
  const type = String(dataType || "").toLowerCase();
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (type === "date") return iso.slice(0, 10);
    return iso.replace("T", " ").replace(/(?:\.000)?Z$/u, "");
  }
  const source = String(value).trim();
  if (type === "date") return source.slice(0, 10);
  if (type === "datetime" || type === "timestamp") {
    return source.replace("T", " ").replace(/Z$/u, "").replace(/\.(\d*?[1-9])0+$/u, ".$1").replace(/\.0+$/u, "");
  }
  return source;
}
function normalizedJson(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) return stable(value);
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!(source.startsWith("{") || source.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? stable(parsed) : null;
  } catch {
    return null;
  }
}
function normalizeValue(value, dataType = "", column = "") {
  if (value === null || value === undefined) return "null:";
  if (Buffer.isBuffer(value)) return "hex:" + value.toString("hex").toLowerCase();
  const type = String(dataType || "").toLowerCase();
  if (value instanceof Date || new Set(["date","datetime","timestamp","time","year"]).has(type)) {
    return "temporal:" + normalizeTemporal(value, type);
  }
  const json = normalizedJson(value);
  if (json !== null || type === "json" || /(?:^|_)json$/u.test(String(column || "").toLowerCase())) {
    if (json !== null) return "json:" + JSON.stringify(json);
  }
  if (typeof value === "boolean") return "scalar:" + (value ? "1" : "0");
  return "scalar:" + String(value);
}
function identityKey(row, columns) {
  const values = columns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined || clean(value) === "") fail("STAGING_REGISTRY_RECONCILIATION_IDENTITY_MISSING", "Registry identity is missing for " + column + ".");
    return normalizeValue(value);
  });
  return registryFingerprint(values);
}
function rowFingerprint(row, columns, columnTypes = {}) {
  return registryFingerprint(columns.map((column) => [column, normalizeValue(row[column], columnTypes[column], column)]));
}
function tableConfig(table) {
  const entry = CONFIG.tables.find((item) => item.table === table);
  if (!entry) fail("STAGING_REGISTRY_RECONCILIATION_TABLE_FORBIDDEN", "Snapshot references an unregistered table.");
  return entry;
}
function assertStaticAuthority() {
  if (!ARTIFACT || CONFIG.contract !== "mad4b.staging-runtime-registry-reconciliation.v1" || CONFIG.target_environment !== "staging" || CONFIG.target_role !== "runtime"
    || CONFIG.insertion_only !== true || CONFIG.updates_allowed !== false || CONFIG.deletes_allowed !== false || CONFIG.caller_sql_forbidden !== true
    || CONFIG.caller_target_forbidden !== true || CONFIG.production_access_forbidden !== true || CONFIG.provider_access_forbidden !== true
    || CONFIG.credentials_read_allowed !== false || CONFIG.secrets_included !== false || ARTIFACT.source_kind !== "disposable_git_migration_projection"
    || !ARTIFACT.replay_modes?.includes("in_place_registry_reconciliation") || ARTIFACT.conflict_policy !== "insert_missing_fail_closed_on_drift"
    || ARTIFACT.caller_sql_forbidden !== true || ARTIFACT.caller_target_forbidden !== true || ARTIFACT.production_apply_allowed !== false
    || ARTIFACT.provider_apply_allowed !== false) fail("STAGING_REGISTRY_RECONCILIATION_AUTHORITY_INVALID", "Registry reconciliation authority is unsafe.", 500);
}
assertStaticAuthority();

function validateMetadata(metadata, expectedCommit) {
  const expected = requireSha40(expectedCommit, "expected_commit");
  const expectedTables = CONFIG.tables.map((item) => item.table);
  if (metadata?.contract !== CONFIG.source_snapshot_contract || metadata?.file !== CONFIG.source_bundle_file || metadata?.source_kind !== "disposable_git_migration_projection"
    || metadata?.target_role !== "runtime" || metadata?.replay_mode !== "in_place_insert_only" || metadata?.exact_source_commit !== expected
    || metadata?.live_environment_data_copied !== false || metadata?.production_accessed !== false || metadata?.provider_accessed !== false
    || metadata?.secrets_included !== false || JSON.stringify(metadata.tables || []) !== JSON.stringify(expectedTables)) {
    fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_METADATA_INVALID", "Registry reconciliation snapshot metadata is invalid.");
  }
  requireDigest(metadata.sha256, "snapshot sha256");
  requireDigest(metadata.uncompressed_sha256, "snapshot uncompressed sha256");
  if (!Number.isInteger(metadata.statement_count) || metadata.statement_count < 1) fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_COUNT_INVALID", "Snapshot statement count is invalid.");
  for (const entry of CONFIG.tables) {
    const projection = metadata.projections?.[entry.table];
    const columns = projection?.included_columns || [];
    const columnTypes = projection?.column_types || {};
    if (!projection || JSON.stringify(projection.identity_columns || []) !== JSON.stringify(entry.identity_columns) || !columns.length
      || new Set(columns).size !== columns.length || entry.identity_columns.some((column) => !columns.includes(column))
      || columns.some((column) => typeof columnTypes[column] !== "string" || !columnTypes[column])) {
      fail("STAGING_REGISTRY_RECONCILIATION_PROJECTION_INVALID", "Snapshot projection is invalid for " + entry.table + ".");
    }
    const leaked = (CONFIG.forbidden_projected_columns_by_table?.[entry.table] || []).filter((column) => columns.includes(column));
    if (leaked.length) fail("STAGING_REGISTRY_RECONCILIATION_FORBIDDEN_COLUMN_PROJECTED", "Snapshot projected forbidden live/secret binding columns.", 409, { table: entry.table, columns: leaked });
  }
}

export function parseStagingRuntimeRegistrySnapshot({ snapshot_gzip, snapshot_metadata, expected_commit } = {}) {
  validateMetadata(snapshot_metadata, expected_commit);
  if (!Buffer.isBuffer(snapshot_gzip) || snapshot_gzip.length < 1 || snapshot_gzip.length > CONFIG.max_snapshot_compressed_bytes) fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_BOUND_EXCEEDED", "Snapshot compressed byte budget is invalid.");
  if (registrySha256(snapshot_gzip) !== snapshot_metadata.sha256) fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_HASH_MISMATCH", "Snapshot compressed digest mismatch.");
  let sqlBytes;
  try { sqlBytes = zlib.gunzipSync(snapshot_gzip, { maxOutputLength: CONFIG.max_snapshot_uncompressed_bytes }); }
  catch { fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_GZIP_INVALID", "Snapshot gzip is invalid or too large."); }
  if (registrySha256(sqlBytes) !== snapshot_metadata.uncompressed_sha256) fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_HASH_MISMATCH", "Snapshot uncompressed digest mismatch.");
  const statements = splitStatements(sqlBytes.toString("utf8"));
  if (statements.length !== snapshot_metadata.statement_count) fail("STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_COUNT_INVALID", "Snapshot statement count mismatch.");
  const rowsByTable = new Map(CONFIG.tables.map((item) => [item.table, []]));
  const seen = new Set();
  for (const raw of statements) {
    const parsed = parseInsert(raw);
    const entry = tableConfig(parsed.table);
    const projection = snapshot_metadata.projections[parsed.table];
    if (JSON.stringify(parsed.columns) !== JSON.stringify(projection.included_columns)) fail("STAGING_REGISTRY_RECONCILIATION_PROJECTION_INVALID", "Snapshot INSERT columns disagree with projection metadata.");
    const row = Object.fromEntries(parsed.columns.map((column, index) => [column, parsed.values[index]]));
    const identity = identityKey(row, entry.identity_columns);
    const globalIdentity = parsed.table + ":" + identity;
    if (seen.has(globalIdentity)) fail("STAGING_REGISTRY_RECONCILIATION_CANONICAL_IDENTITY_DUPLICATE", "Canonical registry identity is duplicated.", 409, { table: parsed.table, identity_sha256: identity });
    seen.add(globalIdentity);
    rowsByTable.get(parsed.table).push(Object.freeze({
      table: parsed.table,
      identity_sha256: identity,
      canonical_fingerprint: rowFingerprint(row, parsed.columns, projection.column_types),
      statement_sha256: registrySha256(parsed.statement),
      statement: parsed.statement,
      columns: [...parsed.columns],
      row
    }));
  }
  for (const entry of CONFIG.tables) {
    const tableRows = rowsByTable.get(entry.table);
    const expectedCount = Number(snapshot_metadata.row_counts?.[entry.table]);
    if (!Number.isInteger(expectedCount) || expectedCount !== tableRows.length || tableRows.length > CONFIG.max_rows_per_table) fail("STAGING_REGISTRY_RECONCILIATION_TABLE_BOUND_INVALID", "Snapshot table cardinality is invalid for " + entry.table + ".");
  }
  return Object.freeze({ snapshot_sha256: snapshot_metadata.sha256, uncompressed_sha256: snapshot_metadata.uncompressed_sha256, metadata: snapshot_metadata, rows_by_table: rowsByTable });
}

async function inspectSchema(executor) {
  const tables = CONFIG.tables.map((item) => item.table);
  const sql = "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (" + tables.map(() => "?").join(",") + ") ORDER BY TABLE_NAME, ORDINAL_POSITION";
  const schemaRows = await queryRows(executor, sql, tables);
  const columns = new Map(tables.map((table) => [table, new Set()]));
  for (const row of schemaRows) if (columns.has(row.TABLE_NAME)) columns.get(row.TABLE_NAME).add(String(row.COLUMN_NAME));
  const missingTables = tables.filter((table) => columns.get(table).size === 0);
  const missingColumns = [];
  for (const [table, required] of Object.entries(CONFIG.schema_required_columns_by_table || {})) for (const column of required) if (!columns.get(table)?.has(column)) missingColumns.push(table + "." + column);
  return { ready: missingTables.length === 0 && missingColumns.length === 0, missing_tables: missingTables, missing_columns: missingColumns };
}
function publicFinding(item) {
  return { table: item.table, identity_sha256: item.identity_sha256, canonical_fingerprint: item.canonical_fingerprint || null, live_fingerprint: item.live_fingerprint || null, statement_sha256: item.statement_sha256 || null };
}
function accessBlockedInspection(snapshot, error) {
  const accessPrerequisite = classifyStagingRuntimeRegistryReadAccessError(error);
  if (!accessPrerequisite) throw error;
  const schema = Object.freeze({ ready: false, missing_tables: [], missing_columns: [], access_denied: true });
  return Object.freeze({
    contract: "mad4b.staging-runtime-registry-reconciliation-inspection.v1",
    status: "access_not_ready",
    repair_allowed: false,
    schema,
    access_prerequisite: accessPrerequisite,
    missing_count: 0,
    exact_count: 0,
    conflict_count: 0,
    extra_count: 0,
    missing_statement_sha256: [],
    tables: [],
    precondition_fingerprint: registryFingerprint({ source_snapshot_sha256: snapshot.snapshot_sha256, schema, access_prerequisite: accessPrerequisite, tables: [] }),
    production_accessed: false,
    provider_accessed: false,
    secrets_included: false,
  });
}
async function inspectTable(executor, snapshot, entry) {
  const projection = snapshot.metadata.projections[entry.table];
  const columns = projection.included_columns;
  const sql = "SELECT " + columns.map(quoteIdentifier).join(", ") + " FROM " + quoteIdentifier(entry.table) + " ORDER BY " + entry.identity_columns.map(quoteIdentifier).join(", ") + " LIMIT " + String(CONFIG.max_rows_per_table + 1);
  const liveRows = await queryRows(executor, sql);
  if (liveRows.length > CONFIG.max_rows_per_table) fail("STAGING_REGISTRY_RECONCILIATION_LIVE_BOUND_EXCEEDED", "Live row budget exceeded for " + entry.table + ".");
  const canonical = new Map((snapshot.rows_by_table.get(entry.table) || []).map((row) => [row.identity_sha256, row]));
  const live = new Map();
  for (const row of liveRows) {
    const identity = identityKey(row, entry.identity_columns);
    if (live.has(identity)) fail("STAGING_REGISTRY_RECONCILIATION_LIVE_IDENTITY_DUPLICATE", "Live registry identity is duplicated.", 409, { table: entry.table, identity_sha256: identity });
    live.set(identity, { fingerprint: rowFingerprint(row, columns, projection.column_types) });
  }
  const missing = [], exact = [], conflicts = [], extra = [];
  for (const [identity, canonicalRow] of canonical.entries()) {
    const liveRow = live.get(identity);
    if (!liveRow) missing.push(canonicalRow);
    else if (liveRow.fingerprint === canonicalRow.canonical_fingerprint) exact.push(canonicalRow);
    else conflicts.push({ table: entry.table, identity_sha256: identity, canonical_fingerprint: canonicalRow.canonical_fingerprint, live_fingerprint: liveRow.fingerprint, statement_sha256: canonicalRow.statement_sha256 });
  }
  for (const [identity, liveRow] of live.entries()) if (!canonical.has(identity)) extra.push({ table: entry.table, identity_sha256: identity, live_fingerprint: liveRow.fingerprint });
  return { table: entry.table, canonical_count: canonical.size, live_count: live.size, missing: missing.map(publicFinding), exact: exact.map(publicFinding), conflicts: conflicts.map(publicFinding), extra: extra.map(publicFinding) };
}

export async function inspectStagingRuntimeRegistrySnapshot({ executor, snapshot_gzip, snapshot_metadata, expected_commit } = {}) {
  if (!executor || typeof executor.query !== "function") throw new TypeError("A query-capable Runtime DB executor is required.");
  const snapshot = parseStagingRuntimeRegistrySnapshot({ snapshot_gzip, snapshot_metadata, expected_commit });
  let schema;
  try {
    await preflightRegistryReadAccess(executor);
    schema = await inspectSchema(executor);
  } catch (error) {
    return accessBlockedInspection(snapshot, error);
  }
  if (!schema.ready) {
    return Object.freeze({ contract: "mad4b.staging-runtime-registry-reconciliation-inspection.v1", status: "schema_not_ready", repair_allowed: false, schema,
      missing_count: 0, exact_count: 0, conflict_count: 0, extra_count: 0, missing_statement_sha256: [], tables: [],
      precondition_fingerprint: registryFingerprint({ source_snapshot_sha256: snapshot.snapshot_sha256, schema, tables: [] }),
      production_accessed: false, provider_accessed: false, secrets_included: false });
  }
  const reports = [];
  try {
    for (const entry of CONFIG.tables) reports.push(await inspectTable(executor, snapshot, entry));
  } catch (error) {
    return accessBlockedInspection(snapshot, error);
  }
  const missing = reports.flatMap((item) => item.missing);
  const exact = reports.flatMap((item) => item.exact);
  const conflicts = reports.flatMap((item) => item.conflicts);
  const extra = reports.flatMap((item) => item.extra);
  const status = conflicts.length ? "conflict" : missing.length ? "missing_rows" : "already_satisfied";
  const precondition = { source_snapshot_sha256: snapshot.snapshot_sha256, schema, tables: reports };
  return Object.freeze({ contract: "mad4b.staging-runtime-registry-reconciliation-inspection.v1", status, repair_allowed: status === "missing_rows", schema,
    missing_count: missing.length, exact_count: exact.length, conflict_count: conflicts.length, extra_count: extra.length,
    missing_statement_sha256: missing.map((row) => row.statement_sha256).sort(), tables: reports,
    precondition_fingerprint: registryFingerprint(precondition), production_accessed: false, provider_accessed: false, secrets_included: false });
}

function planBody(plan) { return Object.fromEntries(PLAN_KEYS.map((key) => [key, plan[key]])); }
export function validateStagingRuntimeRegistryPlan({ plan, actual_commit, snapshot_gzip, snapshot_metadata } = {}) {
  const actual = requireSha40(actual_commit, "actual_commit");
  const snapshot = parseStagingRuntimeRegistrySnapshot({ snapshot_gzip, snapshot_metadata, expected_commit: actual });
  if (!plan || plan.contract !== "mad4b.staging-runtime-registry-reconciliation-plan.v1" || plan.plan_schema_version !== 1
    || plan.expected_repository !== REPOSITORY || plan.expected_commit !== actual || plan.target_environment !== "staging" || plan.target_role !== "runtime"
    || plan.insertion_only !== true || plan.updates_allowed !== false || plan.deletes_allowed !== false || plan.caller_sql_forbidden !== true
    || plan.caller_target_forbidden !== true || plan.production_access_forbidden !== true || plan.provider_access_forbidden !== true
    || plan.same_cycle_readback_required !== true) fail("STAGING_REGISTRY_RECONCILIATION_PLAN_INVALID", "Registry reconciliation plan authority or target is invalid.");
  if (plan.reconciliation_contract_sha256 !== registrySha256(configBytes) || plan.artifact_registry_sha256 !== registrySha256(artifactRegistryBytes)
    || plan.migration_manifest_sha256 !== registrySha256(migrationManifestBytes) || plan.source_artifact?.artifact_key !== CONFIG.source_artifact_key
    || plan.source_artifact?.sha256 !== snapshot.snapshot_sha256 || plan.source_artifact?.uncompressed_sha256 !== snapshot.uncompressed_sha256) {
    fail("STAGING_REGISTRY_RECONCILIATION_SOURCE_AUTHORITY_CHANGED", "Registry reconciliation source authority changed after planning.");
  }
  if (registryFingerprint(planBody(plan)) !== plan.plan_sha256) fail("STAGING_REGISTRY_RECONCILIATION_PLAN_HASH_MISMATCH", "Registry reconciliation plan identity is invalid.");
  return { snapshot, required_confirmation: registryRequiredConfirmation(plan.plan_sha256) };
}

export async function planStagingRuntimeRegistryReconciliation({ executor, snapshot_gzip, snapshot_metadata, expected_commit, actual_commit, repair_generation = 1, supersedes_plan_sha256 = null, reconciliation_evidence_hash = null, previous_outcome = null } = {}) {
  const expected = requireSha40(expected_commit, "expected_commit");
  const actual = requireSha40(actual_commit, "actual_commit");
  if (expected !== actual) fail("STAGING_REGISTRY_RECONCILIATION_COMMIT_MISMATCH", "Planning requires the exact checked-out commit.");
  if (!Number.isInteger(repair_generation) || repair_generation < 1) fail("STAGING_REGISTRY_RECONCILIATION_GENERATION_INVALID", "Repair generation is invalid.");
  const snapshot = parseStagingRuntimeRegistrySnapshot({ snapshot_gzip, snapshot_metadata, expected_commit: expected });
  const inspection = await inspectStagingRuntimeRegistrySnapshot({ executor, snapshot_gzip, snapshot_metadata, expected_commit: expected });
  const body = { contract: "mad4b.staging-runtime-registry-reconciliation-plan.v1", plan_schema_version: 1, expected_repository: REPOSITORY, expected_commit: expected,
    target_environment: "staging", target_role: "runtime", reconciliation_contract_sha256: registrySha256(configBytes),
    artifact_registry_sha256: registrySha256(artifactRegistryBytes), migration_manifest_sha256: registrySha256(migrationManifestBytes),
    source_artifact: { artifact_key: CONFIG.source_artifact_key, file: CONFIG.source_bundle_file, sha256: snapshot.snapshot_sha256, uncompressed_sha256: snapshot.uncompressed_sha256, statement_count: snapshot.metadata.statement_count },
    precondition_fingerprint: inspection.precondition_fingerprint, status_before: inspection.status, repair_allowed: inspection.repair_allowed,
    missing_count: inspection.missing_count, exact_count: inspection.exact_count, conflict_count: inspection.conflict_count, extra_count: inspection.extra_count,
    missing_statement_sha256: inspection.missing_statement_sha256, same_cycle_readback_required: true, insertion_only: true, updates_allowed: false, deletes_allowed: false,
    caller_sql_forbidden: true, caller_target_forbidden: true, production_access_forbidden: true, provider_access_forbidden: true,
    schema_prerequisites: CONFIG.schema_prerequisites, repair_generation, supersedes_plan_sha256, reconciliation_evidence_hash, previous_outcome };
  const planSha = registryFingerprint(body);
  return Object.freeze({ ...body, plan_sha256: planSha, required_confirmation: registryRequiredConfirmation(planSha), acknowledgement_is_execution_authority: false, secrets_included: false });
}

export function resolveRegistryPlanStatements({ plan, actual_commit, snapshot_gzip, snapshot_metadata } = {}) {
  const { snapshot } = validateStagingRuntimeRegistryPlan({ plan, actual_commit, snapshot_gzip, snapshot_metadata });
  const index = new Map();
  for (const rows of snapshot.rows_by_table.values()) for (const row of rows) index.set(row.statement_sha256, row.statement);
  return plan.missing_statement_sha256.map((digest) => {
    const statement = index.get(digest);
    if (!statement || registrySha256(statement) !== digest || !/^INSERT\s+INTO\b/iu.test(stripLeadingComments(statement))) fail("STAGING_REGISTRY_RECONCILIATION_STATEMENT_AUTHORITY_INVALID", "Planned statement no longer resolves from the verified snapshot.");
    return Object.freeze({ statement_sha256: digest, statement });
  });
}
