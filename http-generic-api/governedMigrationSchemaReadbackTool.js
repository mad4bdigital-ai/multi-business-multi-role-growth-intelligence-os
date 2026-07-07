import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import { splitGovernedMigrationStatements } from "./governedMigrationExecutionTool.js";

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const MIGRATION_PATTERN = /^[A-Za-z0-9._-]+\.sql$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

const DEFAULT_EXPECTATIONS = Object.freeze({
  "20260704_operational_alert_lifecycle_fingerprints.sql": Object.freeze({
    tables: Object.freeze(["operational_alert_lifecycle_events"]),
    columns: Object.freeze([
      { table: "operational_alerts", column: "operation_fingerprint_sha256" },
      { table: "operational_alerts", column: "resource_fingerprint_sha256" },
      { table: "operational_alerts", column: "lifecycle_revision" },
      { table: "operational_alert_lifecycle_events", column: "event_id" },
      { table: "operational_alert_lifecycle_events", column: "alert_id" },
      { table: "operational_alert_lifecycle_events", column: "idempotency_key" },
      { table: "operational_alert_lifecycle_events", column: "secrets_included" },
    ]),
    indexes: Object.freeze([
      { table: "operational_alerts", index: "idx_operational_alert_operation_resource" },
      { table: "operational_alerts", index: "idx_operational_alert_lifecycle_revision" },
      { table: "operational_alert_lifecycle_events", index: "uq_operational_alert_lifecycle_event_idempotency" },
      { table: "operational_alert_lifecycle_events", index: "idx_operational_alert_lifecycle_event_operation_resource" },
    ]),
    rule_conditions: Object.freeze([
      { rule_key: "alert_execution_failed", source_type: "execution_log", condition_key: "execution_status=failed AND no later success for the same operation and resource fingerprints" },
    ]),
  }),
});

function readbackError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeMigration(value = "") {
  const migration = compact(value, 255);
  if (!MIGRATION_PATTERN.test(migration) || path.basename(migration) !== migration) {
    throw readbackError("invalid_migration_filename", "migration must be one repository migration filename ending in .sql.");
  }
  return migration;
}

function normalizeIdentifier(value = "", field = "identifier") {
  const identifier = compact(value, 191);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw readbackError("invalid_schema_readback_identifier", `${field} must contain only letters, numbers, and underscores.`, 400, { field });
  }
  return identifier;
}

function normalizeChecksum(value = "") {
  const checksum = compact(value, 64).toLowerCase();
  if (!SHA256_PATTERN.test(checksum)) {
    throw readbackError("invalid_expected_migration_checksum", "expected_checksum_sha256 must be a lowercase SHA-256 value.");
  }
  return checksum;
}

function normalizeStatementCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw readbackError("invalid_expected_statement_count", "expected_statement_count must be an integer from 1 to 5000.");
  }
  return count;
}

function arrayFrom(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeExpectations(input = {}) {
  const migration = normalizeMigration(input.migration);
  const defaults = DEFAULT_EXPECTATIONS[migration] || {};
  const tables = [...new Set(arrayFrom(input.expected_tables, defaults.tables || []).map((table) => normalizeIdentifier(table, "expected_tables")))];
  const columns = arrayFrom(input.expected_columns, defaults.columns || []).map((entry) => ({
    table: normalizeIdentifier(entry?.table, "expected_columns.table"),
    column: normalizeIdentifier(entry?.column, "expected_columns.column"),
  }));
  const indexes = arrayFrom(input.expected_indexes, defaults.indexes || []).map((entry) => ({
    table: normalizeIdentifier(entry?.table, "expected_indexes.table"),
    index: normalizeIdentifier(entry?.index, "expected_indexes.index"),
  }));
  const ruleConditions = arrayFrom(input.expected_rule_conditions, defaults.rule_conditions || [])
    .map((entry) => ({
      rule_key: compact(entry?.rule_key, 191),
      source_type: compact(entry?.source_type, 128),
      condition_key: compact(entry?.condition_key, 512),
    }))
    .filter((entry) => entry.rule_key && entry.source_type && entry.condition_key);
  return { migration, tables, columns, indexes, ruleConditions };
}

function placeholders(values = []) {
  return values.map(() => "?").join(", ");
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

async function readMigrationFile({ migration, expectedChecksum, expectedStatementCount, readFile, migrationsDir }) {
  const sql = await readFile(path.join(migrationsDir, migration), "utf8");
  const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
  const statementCount = splitGovernedMigrationStatements(sql).length;
  if (checksum !== expectedChecksum) {
    throw readbackError("migration_checksum_mismatch", "Merged migration checksum does not match expected_checksum_sha256.", 409, { migration, expected_checksum_sha256: expectedChecksum, actual_checksum_sha256: checksum });
  }
  if (statementCount !== expectedStatementCount) {
    throw readbackError("migration_statement_count_mismatch", "Merged migration statement count does not match expected_statement_count.", 409, { migration, expected_statement_count: expectedStatementCount, actual_statement_count: statementCount });
  }
  return { checksum, statementCount };
}

function buildMissing({ tables, columns, indexes, ruleConditions, tableRows, columnRows, indexRows, ruleRows }) {
  const presentTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const presentColumns = new Set(columnRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const presentIndexes = new Set(indexRows.map((row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`));
  const presentRules = new Set(ruleRows.map((row) => `${row.rule_key}.${row.source_type}.${row.condition_key}`));
  return {
    tables: tables.filter((table) => !presentTables.has(table)),
    columns: columns.filter((entry) => !presentColumns.has(`${entry.table}.${entry.column}`)),
    indexes: indexes.filter((entry) => !presentIndexes.has(`${entry.table}.${entry.index}`)),
    rule_conditions: ruleConditions.filter((entry) => !presentRules.has(`${entry.rule_key}.${entry.source_type}.${entry.condition_key}`)),
  };
}

export async function runGovernedMigrationSchemaReadback(input = {}, deps = {}) {
  const expectedChecksum = normalizeChecksum(input.expected_checksum_sha256);
  const expectedStatementCount = normalizeStatementCount(input.expected_statement_count);
  const expectations = normalizeExpectations(input);
  const pool = deps.pool || getPool();
  const readFile = deps.readFile || fs.readFile;
  const migrationsDir = deps.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const migrationFile = await readMigrationFile({ migration: expectations.migration, expectedChecksum, expectedStatementCount, readFile, migrationsDir });
  const allTables = unique([...expectations.tables, ...expectations.columns.map((entry) => entry.table), ...expectations.indexes.map((entry) => entry.table)]);
  const allColumns = unique(expectations.columns.map((entry) => entry.column));
  const allIndexes = unique(expectations.indexes.map((entry) => entry.index));
  const tableRows = allTables.length ? await queryRows(pool, `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(allTables)}) ORDER BY TABLE_NAME`, allTables) : [];
  const columnRows = allTables.length && allColumns.length ? await queryRows(pool, `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(allTables)}) AND COLUMN_NAME IN (${placeholders(allColumns)}) ORDER BY TABLE_NAME, ORDINAL_POSITION`, [...allTables, ...allColumns]) : [];
  const indexRows = allTables.length && allIndexes.length ? await queryRows(pool, `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(allTables)}) AND INDEX_NAME IN (${placeholders(allIndexes)}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [...allTables, ...allIndexes]) : [];
  const ledgerRows = await queryRows(pool, `SELECT run_id, migration_file, migration_checksum_sha256, mode, applied_at, statement_count, preflight_status, preflight_risk_count, secrets_included, capability_envelope_id FROM governed_migration_ledger WHERE migration_file = ? AND migration_checksum_sha256 = ? ORDER BY applied_at DESC LIMIT 1`, [expectations.migration, expectedChecksum]);
  const ruleRows = expectations.ruleConditions.length ? await queryRows(pool, `SELECT rule_key, source_type, condition_key, status, updated_at FROM operational_alert_rule_registry WHERE (${expectations.ruleConditions.map(() => "(rule_key = ? AND source_type = ? AND condition_key = ?)").join(" OR ")}) ORDER BY rule_key, source_type`, expectations.ruleConditions.flatMap((entry) => [entry.rule_key, entry.source_type, entry.condition_key])) : [];
  const missing = buildMissing({ tables: expectations.tables, columns: expectations.columns, indexes: expectations.indexes, ruleConditions: expectations.ruleConditions, tableRows, columnRows, indexRows, ruleRows });
  const ledger = ledgerRows[0] || null;
  const readbackStatus = ledger && !missing.tables.length && !missing.columns.length && !missing.indexes.length && !missing.rule_conditions.length ? "pass" : "fail";
  return {
    ok: readbackStatus === "pass",
    readback_status: readbackStatus,
    migration: expectations.migration,
    migration_checksum_sha256: migrationFile.checksum,
    statement_count: migrationFile.statementCount,
    ledger: ledger ? { found: true, run_id: ledger.run_id, migration_file: ledger.migration_file, migration_checksum_sha256: ledger.migration_checksum_sha256, mode: ledger.mode, applied_at: ledger.applied_at, statement_count: Number(ledger.statement_count || 0), preflight_status: ledger.preflight_status || null, preflight_risk_count: Number(ledger.preflight_risk_count || 0), secrets_included: Boolean(Number(ledger.secrets_included || 0)), capability_envelope_id: ledger.capability_envelope_id || null } : { found: false },
    schema: { tables: tableRows, columns: columnRows, indexes: indexRows, rule_conditions: ruleRows },
    expectations: { tables: expectations.tables, columns: expectations.columns, indexes: expectations.indexes, rule_conditions: expectations.ruleConditions, missing },
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
}
