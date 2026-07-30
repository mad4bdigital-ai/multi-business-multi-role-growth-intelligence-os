import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDelegationGrantMariaDbReadiness } from "./delegationGrantMariaDbValidationService.js";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";

export const DELEGATION_GRANT_MARIADB_READINESS_COLLECTOR_VERSION =
  "spec011-delegation-grant-mariadb-readiness-collector-v1";
export const DELEGATION_GRANT_MARIADB_MIGRATION_FILE =
  "20260725_agent_delegation_grant_persistence_contract.sql";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function readinessError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function rows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : [];
}

function assertPool(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw readinessError(500, "DELEGATION_MARIADB_READINESS_POOL_INVALID", "A query-capable MariaDB pool is required.");
  }
}

function parseVersion(value = "") {
  const source = String(value || "");
  const match = source.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { family: "unknown", major: 0, minor: 0, patch: 0 };
  return {
    family: /mariadb/i.test(source) ? "mariadb" : "mysql",
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function versionAtLeast(version, target) {
  for (const key of ["major", "minor", "patch"]) {
    if (version[key] > target[key]) return true;
    if (version[key] < target[key]) return false;
  }
  return true;
}

function checkConstraintsEnforced(versionString) {
  const version = parseVersion(versionString);
  if (version.family === "mariadb") {
    return versionAtLeast(version, { major: 10, minor: 2, patch: 1 });
  }
  if (version.family === "mysql") {
    return versionAtLeast(version, { major: 8, minor: 0, patch: 16 });
  }
  return false;
}

async function queryRows(pool, sql, params = []) {
  return rows(await pool.query(sql, params));
}

async function readTransactionIsolation(pool) {
  try {
    const result = await queryRows(pool, "SELECT @@SESSION.transaction_isolation AS transaction_isolation");
    return compact(result[0]?.transaction_isolation, 64).toUpperCase();
  } catch (error) {
    if (!/unknown system variable|ER_UNKNOWN_SYSTEM_VARIABLE/i.test(String(error?.message || ""))) throw error;
    const result = await queryRows(pool, "SELECT @@SESSION.tx_isolation AS transaction_isolation");
    return compact(result[0]?.transaction_isolation, 64).toUpperCase();
  }
}

export async function collectDelegationGrantMariaDbReadinessEvidence({
  pool,
  migrationFile = DELEGATION_GRANT_MARIADB_MIGRATION_FILE,
  expectedMigrationChecksum = null,
  runtimeAuthorityEnabled = false,
  now = new Date().toISOString(),
} = {}) {
  assertPool(pool);
  const normalizedMigration = path.basename(compact(migrationFile, 255));
  if (!normalizedMigration || normalizedMigration !== migrationFile || !normalizedMigration.endsWith(".sql")) {
    throw readinessError(400, "DELEGATION_MARIADB_MIGRATION_FILE_INVALID", "migrationFile must be one repository SQL migration filename.");
  }

  const sql = await readFile(path.join(MIGRATIONS_DIR, normalizedMigration), "utf8");
  const migrationChecksum = sha256(sql);
  const statements = splitSqlStatements(sql);
  const statementCount = statements.length;
  const preflight = assessMigrationSqlPreflight(normalizedMigration, sql);
  const expectedChecksum = compact(expectedMigrationChecksum, 64).toLowerCase();
  if (expectedChecksum && !HASH_PATTERN.test(expectedChecksum)) {
    throw readinessError(400, "DELEGATION_MARIADB_EXPECTED_CHECKSUM_INVALID", "expectedMigrationChecksum must be a SHA-256 hash.");
  }

  const ledgerRows = await queryRows(
    pool,
    `SELECT run_id, migration_file, migration_checksum_sha256, mode, statement_count,
            preflight_status, preflight_risk_count, applied_at, secrets_included
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ? AND mode = 'apply'
      ORDER BY applied_at DESC
      LIMIT 2`,
    [normalizedMigration, migrationChecksum],
  );
  const ledger = ledgerRows[0] || null;

  const tableRows = await queryRows(
    pool,
    `SELECT table_name, engine, table_collation
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN ('agent_delegations', 'repository_automation_receipts')
      ORDER BY table_name`,
  );
  const columnRows = await queryRows(
    pool,
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'agent_delegations'
      ORDER BY ordinal_position`,
  );
  const agentIndexRows = await queryRows(
    pool,
    `SELECT DISTINCT index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'agent_delegations'
      ORDER BY index_name`,
  );
  const receiptIndexRows = await queryRows(
    pool,
    `SELECT DISTINCT index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'repository_automation_receipts'
      ORDER BY index_name`,
  );
  const viewRows = await queryRows(
    pool,
    `SELECT table_name
       FROM information_schema.views
      WHERE table_schema = DATABASE() AND table_name = 'effective_agent_delegation_grants_v'
      LIMIT 1`,
  );
  const schemaRows = await queryRows(
    pool,
    `SELECT default_character_set_name AS character_set,
            default_collation_name AS collation
       FROM information_schema.schemata
      WHERE schema_name = DATABASE()
      LIMIT 1`,
  );
  const engineRows = await queryRows(pool, "SELECT @@VERSION AS version, @@SESSION.sql_mode AS sql_mode");
  const jsonRows = await queryRows(pool, "SELECT JSON_VALID('[]') AS json_supported");
  const isolation = await readTransactionIsolation(pool);

  const allInnoDb = tableRows.length === 2
    && tableRows.every((row) => String(row.engine || "").toLowerCase() === "innodb");
  const schema = schemaRows[0] || {};
  const engine = engineRows[0] || {};
  const transactionIsolationVerified = [
    "READ-UNCOMMITTED",
    "READ-COMMITTED",
    "REPEATABLE-READ",
    "SERIALIZABLE",
  ].includes(isolation);

  const ledgerReadbackComplete = Boolean(
    ledger
      && ledger.mode === "apply"
      && ledger.migration_checksum_sha256 === migrationChecksum
      && Number(ledger.statement_count) === statementCount
      && ledger.preflight_status === "pass"
      && Number(ledger.preflight_risk_count || 0) === 0
      && Number(ledger.secrets_included || 0) === 0,
  );
  const checksumPinned = !expectedChecksum || expectedChecksum === migrationChecksum;

  const result = evaluateDelegationGrantMariaDbReadiness({
    migrationEvidence: {
      mode: ledgerReadbackComplete && checksumPinned ? "apply" : "blocked",
      ledger_status: ledgerReadbackComplete && checksumPinned ? "applied" : "missing_or_mismatched",
      migration_checksum_sha256: migrationChecksum,
      statement_count: statementCount,
      readback_complete: ledgerReadbackComplete && checksumPinned,
      ledger_evidence_ref: ledger?.run_id ? `governed_migration_ledger:${ledger.run_id}` : null,
    },
    schemaReadback: {
      status: "pass",
      readback_complete: true,
      row_data_read: false,
      secrets_included: false,
      tables: tableRows.map((row) => row.table_name),
      agent_delegations_columns: columnRows.map((row) => row.column_name),
      agent_delegations_indexes: agentIndexRows.map((row) => row.index_name),
      repository_automation_receipts_indexes: receiptIndexRows.map((row) => row.index_name),
      effective_view_present: viewRows.length === 1,
    },
    engineEvidence: {
      storage_engine: allInnoDb ? "InnoDB" : "mixed_or_missing",
      character_set: schema.character_set || "",
      collation: schema.collation || "",
      sql_mode: engine.sql_mode || "",
      json_supported: Number(jsonRows[0]?.json_supported || 0) === 1,
      check_constraints_enforced: checkConstraintsEnforced(engine.version),
      transaction_isolation_verified: transactionIsolationVerified,
      secrets_included: false,
    },
    rollbackAssessment: {
      status: preflight.status === "pass" && Number(preflight.risk_count || 0) === 0 ? "pass" : "blocked",
      destructive_change_detected: Number(preflight.risk_count || 0) > 0,
      runtime_binding_enabled: runtimeAuthorityEnabled === true,
    },
    now,
  });

  return {
    ...result,
    collector_version: DELEGATION_GRANT_MARIADB_READINESS_COLLECTOR_VERSION,
    migration_file: normalizedMigration,
    expected_migration_checksum_sha256: expectedChecksum || null,
    checksum_pin_match: checksumPinned,
    ledger_match_count: ledgerRows.length,
    database_version: compact(engine.version, 128),
    transaction_isolation: isolation,
    preflight: {
      status: preflight.status,
      risk_count: Number(preflight.risk_count || 0),
      statement_count: statementCount,
    },
    guarantees: {
      ...result.guarantees,
      metadata_queries_only: true,
      row_data_read: false,
      database_write_performed: false,
      migration_apply_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingDelegationGrantMariaDbReadinessCollector = {
  sha256,
  parseVersion,
  versionAtLeast,
  checkConstraintsEnforced,
};
