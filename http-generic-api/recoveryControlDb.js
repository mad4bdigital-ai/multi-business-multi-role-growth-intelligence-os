import mysql from "mysql2/promise";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

let recoveryControlPool = null;

export const RECOVERY_CONTROL_STORE_READINESS_CONTRACT = "mad4b.recovery-control-store-readiness.v1";

export const RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS recovery_control_records (
    record_type VARCHAR(32) NOT NULL,
    record_id VARCHAR(191) NOT NULL,
    plan_id VARCHAR(191) NULL,
    step_id VARCHAR(191) NULL,
    idempotency_key VARCHAR(191) NULL,
    payload_json LONGTEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (record_type, record_id),
    KEY idx_recovery_control_plan_step (record_type, plan_id, step_id, updated_at),
    KEY idx_recovery_control_idempotency (record_type, idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_run_idempotency (
    idempotency_key VARCHAR(191) NOT NULL,
    run_id VARCHAR(191) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key),
    KEY idx_recovery_control_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_idempotency_receipts (
    idempotency_key VARCHAR(191) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_index (
    plan_id VARCHAR(191) NOT NULL,
    step_id VARCHAR(191) NOT NULL,
    approval_id VARCHAR(191) NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (plan_id, step_id),
    KEY idx_recovery_control_approval_id (approval_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_execution_claims (
    idempotency_key VARCHAR(191) NOT NULL,
    claim_id VARCHAR(191) NOT NULL,
    status VARCHAR(32) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key),
    UNIQUE KEY uq_recovery_control_claim_id (claim_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_reservations (
    reservation_key CHAR(64) NOT NULL,
    approval_id VARCHAR(191) NOT NULL,
    plan_hash CHAR(64) NOT NULL,
    step_id VARCHAR(191) NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reservation_key),
    KEY idx_recovery_control_approval_reservation (approval_id, idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_finalizations (
    approval_id VARCHAR(191) NOT NULL,
    finalized_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (approval_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_execution_tickets (
    ticket_id VARCHAR(191) NOT NULL,
    ticket_hash CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'issued',
    reservation_idempotency_key VARCHAR(191) NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    reserved_at DATETIME(6) NULL,
    finalized_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (ticket_id),
    KEY idx_recovery_control_ticket_state (state),
    KEY idx_recovery_control_ticket_hash (ticket_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_evidence_events (
    event_id CHAR(36) NOT NULL,
    run_id VARCHAR(191) NOT NULL,
    event_hash CHAR(64) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_recovery_control_event_hash (event_hash),
    KEY idx_recovery_control_evidence_run (run_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_exception_events (
    event_id CHAR(36) NOT NULL,
    exception_id VARCHAR(191) NOT NULL,
    event_hash CHAR(64) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_recovery_control_exception_event_hash (event_hash),
    KEY idx_recovery_control_exception_event (exception_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_locks (
    target_key VARCHAR(191) NOT NULL,
    fence_counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lease_id VARCHAR(191) NULL,
    fencing_token VARCHAR(255) NULL,
    plan_hash CHAR(64) NULL,
    expires_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (target_key),
    UNIQUE KEY uq_recovery_control_lease_id (lease_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

// The fixed DDL is the sole schema inventory. Unsupported repository DDL fails
// at module load instead of silently shrinking readiness coverage.
function buildSchemaInventory(statements) {
  return Object.freeze(Object.fromEntries(statements.map((statement) => {
    const match = /^CREATE TABLE IF NOT EXISTS (\w+) \(\n([\s\S]+)\n  \) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci$/u.exec(statement);
    if (!match) throw new Error("Unsupported Recovery Control Store schema statement");
    const columns = {};
    const indexes = [];
    for (const raw of match[2].split("\n")) {
      const line = raw.trim().replace(/,$/u, "");
      const index = /^(PRIMARY KEY|UNIQUE KEY \w+|KEY \w+) \(([^)]+)\)$/u.exec(line);
      if (index) {
        indexes.push(Object.freeze({
          columns: index[2].replace(/\s+/gu, ""),
          unique: !index[1].startsWith("KEY "),
          primary: index[1] === "PRIMARY KEY",
        }));
        continue;
      }
      const column = /^(\w+) ((?:VARCHAR|CHAR|DATETIME)\(\d+\)|LONGTEXT|BIGINT UNSIGNED) (NOT NULL|NULL)(?: DEFAULT ('[^']*'|CURRENT_TIMESTAMP\(6\)|0))?( ON UPDATE CURRENT_TIMESTAMP\(6\))?$/u.exec(line);
      if (!column) throw new Error("Unsupported Recovery Control Store column definition");
      columns[column[1]] = Object.freeze({
        type: column[2].toLowerCase(), nullable: column[3] === "NULL",
        default: normalizeDefault(column[4]), on_update: Boolean(column[5]),
      });
    }
    return [match[1], Object.freeze({ columns: Object.freeze(columns), indexes: Object.freeze(indexes) })];
  })));
}

function normalizeDefault(value) {
  if (value == null || String(value).toUpperCase() === "NULL") return null;
  return String(value).replace(/^'(.*)'$/u, "$1").replace(/CURRENT_TIMESTAMP/giu, "current_timestamp");
}

export const RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY = buildSchemaInventory(RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS);

function text(value) {
  return String(value ?? "").trim();
}

function boundedInteger(value, fallback, { min = 1, max = 10 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function boundaryDetails(extra = {}) {
  return {
    independent_store_required: true,
    target_database_binding: "forbidden",
    runtime_database_fallback_allowed: false,
    governance_database_fallback_allowed: false,
    runtime_persistence_database_fallback_allowed: false,
    target_identity_reuse_allowed: false,
    secrets_included: false,
    ...extra,
  };
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = boundaryDetails(details);
  throw error;
}

function resolveTargetDatabaseBindings(contract = readRuntimeBootstrapContract()) {
  const hostLocal = contract?.target_binding?.target_sources?.host_local_role_env;
  const roles = Array.isArray(hostLocal?.selected_role_enum) ? hostLocal.selected_role_enum : [];
  const prefixes = hostLocal?.role_environment_prefixes;
  if (!roles.length || !prefixes || typeof prefixes !== "object" || Array.isArray(prefixes)) {
    fail(
      "RECOVERY_CONTROL_DB_ROLE_REGISTRY_INVALID",
      "Recovery control DB isolation requires the canonical host-local database role registry.",
      { role_registry_source: "runtime-bootstrap-contract" },
    );
  }

  const bindings = roles.map((role) => {
    const prefix = text(prefixes[role]);
    if (!prefix) {
      fail(
        "RECOVERY_CONTROL_DB_ROLE_REGISTRY_INVALID",
        "Every canonical target database role requires an environment prefix.",
        { role_registry_source: "runtime-bootstrap-contract", role },
      );
    }
    return Object.freeze({
      role,
      prefix,
      host: `${prefix}_HOST`,
      port: `${prefix}_PORT`,
      database: `${prefix}_NAME`,
      user: `${prefix}_USER`,
    });
  });

  if (new Set(bindings.map((binding) => binding.role)).size !== bindings.length
    || new Set(bindings.map((binding) => binding.prefix)).size !== bindings.length) {
    fail(
      "RECOVERY_CONTROL_DB_ROLE_REGISTRY_INVALID",
      "Canonical target database roles and environment prefixes must be unique.",
      { role_registry_source: "runtime-bootstrap-contract" },
    );
  }
  return Object.freeze(bindings);
}

const TARGET_DATABASE_BINDINGS = resolveTargetDatabaseBindings();

function firstConfiguredTargetValue(env, key) {
  for (const binding of TARGET_DATABASE_BINDINGS) {
    const value = text(env[binding[key]]);
    if (value) return value;
  }
  return "";
}

function configuredTargetCollisions({ env, database, user }) {
  const databaseCollisions = [];
  const identityCollisions = [];
  for (const binding of TARGET_DATABASE_BINDINGS) {
    const targetDatabase = text(env[binding.database]);
    const targetUser = text(env[binding.user]);
    if (targetDatabase && targetDatabase === database) databaseCollisions.push(binding.role);
    if (targetUser && targetUser === user) identityCollisions.push(binding.role);
  }
  return { databaseCollisions, identityCollisions };
}

export function resolveRecoveryControlDbConfig(env = process.env) {
  const missing = [
    "RECOVERY_CONTROL_DB_NAME",
    "RECOVERY_CONTROL_DB_USER",
    "RECOVERY_CONTROL_DB_PASSWORD",
  ].filter((key) => !text(env[key]));

  const host = text(env.RECOVERY_CONTROL_DB_HOST) || firstConfiguredTargetValue(env, "host");
  if (!host) missing.push("RECOVERY_CONTROL_DB_HOST|canonical_target_host");

  if (missing.length) {
    fail(
      "RECOVERY_CONTROL_DB_CONFIG_MISSING",
      `Missing required Recovery control DB configuration: ${missing.join(", ")}`,
      { missing },
    );
  }

  const database = text(env.RECOVERY_CONTROL_DB_NAME);
  const user = text(env.RECOVERY_CONTROL_DB_USER);
  const { databaseCollisions, identityCollisions } = configuredTargetCollisions({ env, database, user });

  if (databaseCollisions.length) {
    fail(
      "RECOVERY_CONTROL_DB_DATABASE_NOT_INDEPENDENT",
      "Recovery control DB must be distinct from every registered target database.",
      { conflicting_roles: databaseCollisions },
    );
  }
  if (identityCollisions.length) {
    fail(
      "RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT",
      "Recovery control DB identity must be distinct from every registered target database identity.",
      { conflicting_roles: identityCollisions },
    );
  }

  const targetPort = firstConfiguredTargetValue(env, "port");
  return {
    host,
    port: boundedInteger(env.RECOVERY_CONTROL_DB_PORT || targetPort, 3306, { min: 1, max: 65535 }),
    database,
    user,
    password: String(env.RECOVERY_CONTROL_DB_PASSWORD),
    waitForConnections: true,
    connectionLimit: boundedInteger(env.RECOVERY_CONTROL_DB_CONNECTION_LIMIT, 2, { min: 1, max: 5 }),
    queueLimit: 0,
    connectTimeout: boundedInteger(env.RECOVERY_CONTROL_DB_CONNECT_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

export function getRecoveryControlPool() {
  if (!recoveryControlPool) recoveryControlPool = mysql.createPool(resolveRecoveryControlDbConfig());
  return recoveryControlPool;
}

export async function testRecoveryControlConnection() {
  const conn = await getRecoveryControlPool().getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

function evaluateControlStoreSchema(columnRows = [], indexRows = [], tableRows = []) {
  const missingTables = [];
  const missingColumns = [];
  const missingIndexes = [];
  const malformedColumns = [];
  const malformedTables = [];
  const rowValue = (row, key) => row[key] ?? row[key.toLowerCase()];
  for (const [table, required] of Object.entries(RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY)) {
    const metadata = tableRows.find((row) => rowValue(row, "TABLE_NAME") === table);
    if (!metadata) {
      missingTables.push(table);
      // A missing table is creatable. Its absent columns/indexes are not drift.
      continue;
    }
    if (rowValue(metadata, "TABLE_TYPE") !== "BASE TABLE"
      || String(rowValue(metadata, "ENGINE")).toLowerCase() !== "innodb"
      || rowValue(metadata, "TABLE_COLLATION") !== "utf8mb4_unicode_ci") malformedTables.push(table);
    const columns = columnRows.filter((row) => rowValue(row, "TABLE_NAME") === table);
    for (const [name, expected] of Object.entries(required.columns)) {
      const row = columns.find((entry) => rowValue(entry, "COLUMN_NAME") === name);
      if (!row) { missingColumns.push(`${table}.${name}`); continue; }
      const type = String(rowValue(row, "COLUMN_TYPE")).toLowerCase().replace(/bigint\(\d+\)/u, "bigint");
      const extra = String(rowValue(row, "EXTRA") || "").toLowerCase();
      if (type !== expected.type
        || rowValue(row, "IS_NULLABLE") !== (expected.nullable ? "YES" : "NO")
        || normalizeDefault(rowValue(row, "COLUMN_DEFAULT")) !== expected.default
        || extra.includes("on update current_timestamp(6)") !== expected.on_update
        || /(?:virtual|stored) generated/u.test(extra)
        || (/^(?:varchar|char|longtext)/u.test(expected.type) && rowValue(row, "COLLATION_NAME") !== "utf8mb4_unicode_ci")) {
        malformedColumns.push(`${table}.${name}`);
      }
    }
    const indexes = indexRows.filter((row) => rowValue(row, "TABLE_NAME") === table);
    for (const expected of required.indexes) {
      if (!indexes.some((row) => rowValue(row, "columns") === expected.columns
        && Number(rowValue(row, "NON_UNIQUE")) === (expected.unique ? 0 : 1)
        && (!expected.primary || rowValue(row, "INDEX_NAME") === "PRIMARY")
        && String(rowValue(row, "INDEX_TYPE")).toUpperCase() === "BTREE")) {
        missingIndexes.push(`${table}(${expected.columns})${expected.unique ? ":unique" : ""}`);
      }
    }
  }
  return {
    ready: [missingTables, missingColumns, missingIndexes, malformedColumns, malformedTables].every((items) => items.length === 0),
    missing_tables: missingTables, missing_columns: missingColumns, missing_indexes: missingIndexes,
    malformed_columns: malformedColumns, malformed_tables: malformedTables,
  };
}

export async function getRecoveryControlStoreReadiness({
  env = process.env,
  poolProvider = getRecoveryControlPool,
} = {}) {
  const base = {
    contract: RECOVERY_CONTROL_STORE_READINESS_CONTRACT,
    scope: "durable_inspection",
    schema_scope: "mutation_grade",
    mutation_grade_schema_ready: false,
    independent_of_target_databases: false,
    config_complete: false,
    connection_ready: false,
    schema_ready: false,
    required_tables: Object.keys(RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY),
    missing_tables: [],
    missing_columns: [],
    missing_indexes: [],
    malformed_columns: [],
    malformed_tables: [],
    read_only_probe: true,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    schema_auto_apply: false,
    provider_accessed: false,
    secrets_included: false,
  };

  let config;
  try {
    config = resolveRecoveryControlDbConfig(env);
  } catch (error) {
    return {
      ...base,
      ready: false,
      error_code: error?.code || "RECOVERY_CONTROL_DB_CONFIG_INVALID",
    };
  }

  const report = {
    ...base,
    config_complete: true,
    independent_of_target_databases: true,
    database_connection_performed: true,
  };
  let conn = null;
  try {
    const pool = poolProvider();
    conn = await pool.getConnection();
    await conn.ping();
    report.connection_ready = true;
    const tableNames = Object.keys(RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY);
    const placeholders = tableNames.map(() => "?").join(",");
    const [columnRows] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (${placeholders})`,
      [config.database, ...tableNames],
    );
    const [indexRows] = await conn.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE,
              GROUP_CONCAT(CONCAT(COLUMN_NAME, IF(SUB_PART IS NULL, '', CONCAT(':prefix:', SUB_PART))) ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (${placeholders})
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE`,
      [config.database, ...tableNames],
    );
    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`,
      [config.database, ...tableNames],
    );
    const schema = evaluateControlStoreSchema(columnRows, indexRows, tableRows);
    report.schema_ready = schema.ready;
    report.mutation_grade_schema_ready = schema.ready;
    report.malformed_columns = schema.malformed_columns;
    report.malformed_tables = schema.malformed_tables;
    report.missing_tables = schema.missing_tables;
    report.missing_columns = schema.missing_columns;
    report.missing_indexes = schema.missing_indexes;
    return {
      ...report,
      ready: report.connection_ready && schema.ready,
      error_code: schema.ready ? null : "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY",
    };
  } catch (error) {
    return {
      ...report,
      ready: false,
      error_code: error?.code || "RECOVERY_CONTROL_STORE_READINESS_FAILED",
    };
  } finally {
    try { conn?.release?.(); } catch { }
  }
}

export async function closeRecoveryControlPool() {
  if (!recoveryControlPool) return;
  const current = recoveryControlPool;
  recoveryControlPool = null;
  await current.end();
}

export const _testingRecoveryControlDb = Object.freeze({
  TARGET_DATABASE_BINDINGS,
  RECOVERY_CONTROL_STORE_SCHEMA_INVENTORY,
  buildSchemaInventory,
  resolveTargetDatabaseBindings,
  configuredTargetCollisions,
  firstConfiguredTargetValue,
  boundedInteger,
  evaluateControlStoreSchema,
});
