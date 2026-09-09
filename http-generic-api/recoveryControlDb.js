import mysql from "mysql2/promise";

let recoveryControlPool = null;

const TARGET_DATABASE_BINDINGS = Object.freeze([
  Object.freeze({ role: "runtime", database: "DB_NAME", user: "DB_USER" }),
  Object.freeze({ role: "governance", database: "GOVERNANCE_DB_NAME", user: "GOVERNANCE_DB_USER" }),
  Object.freeze({ role: "runtime_persistence", database: "RUNTIME_PERSISTENCE_DB_NAME", user: "RUNTIME_PERSISTENCE_DB_USER" }),
]);

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

  const host = text(
    env.RECOVERY_CONTROL_DB_HOST
    || env.DB_HOST
    || env.GOVERNANCE_DB_HOST
    || env.RUNTIME_PERSISTENCE_DB_HOST,
  );
  if (!host) missing.push("RECOVERY_CONTROL_DB_HOST|DB_HOST|GOVERNANCE_DB_HOST|RUNTIME_PERSISTENCE_DB_HOST");

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
      "Recovery control DB must be distinct from every runtime target database.",
      { conflicting_roles: databaseCollisions },
    );
  }
  if (identityCollisions.length) {
    fail(
      "RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT",
      "Recovery control DB identity must be distinct from every runtime target database identity.",
      { conflicting_roles: identityCollisions },
    );
  }

  return {
    host,
    port: boundedInteger(
      env.RECOVERY_CONTROL_DB_PORT
      || env.DB_PORT
      || env.GOVERNANCE_DB_PORT
      || env.RUNTIME_PERSISTENCE_DB_PORT,
      3306,
      { min: 1, max: 65535 },
    ),
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

export async function closeRecoveryControlPool() {
  if (!recoveryControlPool) return;
  const current = recoveryControlPool;
  recoveryControlPool = null;
  await current.end();
}

export const _testingRecoveryControlDb = Object.freeze({
  TARGET_DATABASE_BINDINGS,
  configuredTargetCollisions,
  boundedInteger,
});
