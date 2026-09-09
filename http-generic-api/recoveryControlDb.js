import mysql from "mysql2/promise";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

let recoveryControlPool = null;

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

export async function closeRecoveryControlPool() {
  if (!recoveryControlPool) return;
  const current = recoveryControlPool;
  recoveryControlPool = null;
  await current.end();
}

export const _testingRecoveryControlDb = Object.freeze({
  TARGET_DATABASE_BINDINGS,
  resolveTargetDatabaseBindings,
  configuredTargetCollisions,
  firstConfiguredTargetValue,
  boundedInteger,
});
