import mysql from "mysql2/promise";

let governancePool = null;

function boundedInteger(value, fallback, { min = 1, max = 10 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

export function resolveGovernanceDbConfig(env = process.env) {
  const missing = ["GOVERNANCE_DB_USER", "GOVERNANCE_DB_PASSWORD"].filter((key) => !String(env[key] || "").trim());
  const host = String(env.GOVERNANCE_DB_HOST || env.DB_HOST || "").trim();
  const database = String(env.GOVERNANCE_DB_NAME || env.DB_NAME || "").trim();
  if (!host) missing.push("GOVERNANCE_DB_HOST|DB_HOST");
  if (!database) missing.push("GOVERNANCE_DB_NAME|DB_NAME");
  if (missing.length) {
    const error = new Error(`Missing required governance DB configuration: ${missing.join(", ")}`);
    error.code = "GOVERNANCE_DB_CONFIG_MISSING";
    error.details = {
      missing,
      governance_identity_required: true,
      runtime_identity_fallback_allowed: false,
      same_runtime_identity_rejected: true,
      secrets_included: false,
    };
    throw error;
  }

  const governanceUser = String(env.GOVERNANCE_DB_USER).trim();
  const runtimeUser = String(env.DB_USER || "").trim();
  if (runtimeUser && governanceUser === runtimeUser) {
    const error = new Error("Governance DB writer identity must be distinct from the ordinary runtime DB identity.");
    error.code = "GOVERNANCE_DB_IDENTITY_NOT_DEDICATED";
    error.details = {
      governance_identity_required: true,
      runtime_identity_fallback_allowed: false,
      same_runtime_identity_rejected: true,
      secrets_included: false,
    };
    throw error;
  }

  return {
    host,
    port: boundedInteger(env.GOVERNANCE_DB_PORT || env.DB_PORT, 3306, { min: 1, max: 65535 }),
    database,
    user: governanceUser,
    password: String(env.GOVERNANCE_DB_PASSWORD),
    waitForConnections: true,
    connectionLimit: boundedInteger(env.GOVERNANCE_DB_CONNECTION_LIMIT, 2, { min: 1, max: 5 }),
    queueLimit: 0,
    connectTimeout: boundedInteger(env.GOVERNANCE_DB_CONNECT_TIMEOUT_MS || env.DB_CONNECT_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

export function getGovernancePool() {
  if (!governancePool) governancePool = mysql.createPool(resolveGovernanceDbConfig());
  return governancePool;
}

export async function testGovernanceConnection() {
  const conn = await getGovernancePool().getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

export async function closeGovernancePool() {
  if (!governancePool) return;
  const current = governancePool;
  governancePool = null;
  await current.end();
}
