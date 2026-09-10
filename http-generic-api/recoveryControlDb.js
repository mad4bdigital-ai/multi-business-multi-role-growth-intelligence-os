import mysql from "mysql2/promise";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

let recoveryControlPool = null;

export const RECOVERY_CONTROL_STORE_READINESS_CONTRACT = "mad4b.recovery-control-store-readiness.v1";

const DURABLE_INSPECTION_SCHEMA = Object.freeze({
  recovery_control_records: Object.freeze([
    "record_type",
    "record_id",
    "payload_json",
    "payload_sha256",
    "created_at",
    "updated_at",
  ]),
  recovery_control_run_idempotency: Object.freeze([
    "idempotency_key",
    "run_id",
    "created_at",
    "updated_at",
  ]),
  recovery_control_idempotency_receipts: Object.freeze([
    "idempotency_key",
    "run_id",
    "plan_id",
    "step_id",
    "status",
    "payload_json",
    "payload_sha256",
    "created_at",
    "updated_at",
  ]),
  recovery_control_evidence_events: Object.freeze([
    "event_id",
    "run_id",
    "event_hash",
    "payload_json",
    "created_at",
  ]),
});

const DURABLE_INSPECTION_INDEXES = Object.freeze({
  recovery_control_records: Object.freeze([
    Object.freeze({ columns: "record_type,record_id", unique: true }),
  ]),
  recovery_control_run_idempotency: Object.freeze([
    Object.freeze({ columns: "idempotency_key", unique: true }),
    Object.freeze({ columns: "run_id", unique: false }),
  ]),
  recovery_control_idempotency_receipts: Object.freeze([
    Object.freeze({ columns: "idempotency_key", unique: true }),
    Object.freeze({ columns: "run_id", unique: false }),
  ]),
  recovery_control_evidence_events: Object.freeze([
    Object.freeze({ columns: "event_id", unique: true }),
    Object.freeze({ columns: "run_id", unique: false }),
  ]),
});

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

function normalizedColumnInventory(rows = []) {
  const inventory = new Map();
  for (const row of rows || []) {
    const table = text(row.TABLE_NAME || row.table_name);
    const column = text(row.COLUMN_NAME || row.column_name);
    if (!table || !column) continue;
    if (!inventory.has(table)) inventory.set(table, new Set());
    inventory.get(table).add(column);
  }
  return inventory;
}

function normalizedIndexInventory(rows = []) {
  const inventory = new Map();
  for (const row of rows || []) {
    const table = text(row.TABLE_NAME || row.table_name);
    const columns = text(row.columns || row.COLUMNS || row.column_list);
    if (!table || !columns) continue;
    if (!inventory.has(table)) inventory.set(table, []);
    inventory.get(table).push({
      columns,
      unique: Number(row.NON_UNIQUE ?? row.non_unique ?? 1) === 0,
    });
  }
  return inventory;
}

function evaluateDurableInspectionSchema(columnRows = [], indexRows = []) {
  const columns = normalizedColumnInventory(columnRows);
  const indexes = normalizedIndexInventory(indexRows);
  const missingTables = [];
  const missingColumns = [];
  const missingIndexes = [];

  for (const [table, requiredColumns] of Object.entries(DURABLE_INSPECTION_SCHEMA)) {
    if (!columns.has(table)) {
      missingTables.push(table);
      continue;
    }
    for (const column of requiredColumns) {
      if (!columns.get(table).has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  for (const [table, requiredIndexes] of Object.entries(DURABLE_INSPECTION_INDEXES)) {
    const observed = indexes.get(table) || [];
    for (const required of requiredIndexes) {
      const matched = observed.some((entry) => entry.columns === required.columns && (!required.unique || entry.unique));
      if (!matched) missingIndexes.push(`${table}(${required.columns})${required.unique ? ":unique" : ""}`);
    }
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    missing_indexes: missingIndexes,
  };
}

export async function getRecoveryControlStoreReadiness({
  env = process.env,
  poolProvider = getRecoveryControlPool,
} = {}) {
  const base = {
    contract: RECOVERY_CONTROL_STORE_READINESS_CONTRACT,
    scope: "durable_inspection",
    independent_of_target_databases: false,
    config_complete: false,
    connection_ready: false,
    schema_ready: false,
    required_tables: Object.keys(DURABLE_INSPECTION_SCHEMA),
    missing_tables: [],
    missing_columns: [],
    missing_indexes: [],
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
    const tableNames = Object.keys(DURABLE_INSPECTION_SCHEMA);
    const placeholders = tableNames.map(() => "?").join(",");
    const [columnRows] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (${placeholders})`,
      [config.database, ...tableNames],
    );
    const [indexRows] = await conn.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (${placeholders})
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE`,
      [config.database, ...tableNames],
    );
    const schema = evaluateDurableInspectionSchema(columnRows, indexRows);
    report.schema_ready = schema.ready;
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
  DURABLE_INSPECTION_SCHEMA,
  DURABLE_INSPECTION_INDEXES,
  resolveTargetDatabaseBindings,
  configuredTargetCollisions,
  firstConfiguredTargetValue,
  boundedInteger,
  normalizedColumnInventory,
  normalizedIndexInventory,
  evaluateDurableInspectionSchema,
});
