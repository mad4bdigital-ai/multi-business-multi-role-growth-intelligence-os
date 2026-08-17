import mysql from "mysql2/promise";
import { getPool } from "./db.js";

export const CONTROL_PLANE_WRITE_IDENTITY_CONTRACT = Object.freeze({
  enabled_env: "CONTROL_PLANE_WRITE_AUTHORITY_ENABLED",
  identity_prefix: "CONTROL_PLANE_WRITE_DB_",
  dedicated_identity_required: true,
  runtime_fallback_allowed_only_when_disabled: true,
  root_identity_rejected: true,
  secrets_included: false,
});

let controlPlaneWritePool = null;

function flagEnabled(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function boundedInteger(value, fallback, { min = 1, max = 10 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function missingKeys(env) {
  return [
    "CONTROL_PLANE_WRITE_DB_HOST",
    "CONTROL_PLANE_WRITE_DB_NAME",
    "CONTROL_PLANE_WRITE_DB_USER",
    "CONTROL_PLANE_WRITE_DB_PASSWORD",
  ].filter((key) => !String(env[key] || "").trim());
}

export function controlPlaneWriteAuthorityEnabled(env = process.env) {
  return flagEnabled(env.CONTROL_PLANE_WRITE_AUTHORITY_ENABLED);
}

export function resolveControlPlaneWriteDbConfig(env = process.env) {
  if (!controlPlaneWriteAuthorityEnabled(env)) {
    return {
      enabled: false,
      source: "runtime_db_fallback_disabled",
      identity: String(env.DB_USER || "").trim() || null,
      database: String(env.DB_NAME || "").trim() || null,
      secrets_included: false,
    };
  }

  const missing = missingKeys(env);
  if (missing.length) {
    const error = new Error(`Missing required control-plane write DB environment variables: ${missing.join(", ")}`);
    error.code = "CONTROL_PLANE_WRITE_DB_CONFIG_MISSING";
    error.details = {
      missing,
      dedicated_identity_required: true,
      runtime_fallback_allowed: false,
      root_identity_rejected: true,
      secrets_included: false,
    };
    throw error;
  }

  const user = String(env.CONTROL_PLANE_WRITE_DB_USER).trim();
  const runtimeUser = String(env.DB_USER || "").trim();
  if (!user || user.toLowerCase() === "root" || user.toLowerCase() === "admin") {
    const error = new Error("Control-plane write DB identity must be a dedicated non-root user.");
    error.code = "CONTROL_PLANE_WRITE_DB_IDENTITY_INVALID";
    error.details = {
      dedicated_identity_required: true,
      root_identity_rejected: true,
      secrets_included: false,
    };
    throw error;
  }
  if (runtimeUser && user === runtimeUser) {
    const error = new Error("Control-plane write DB identity must be distinct from DB_USER.");
    error.code = "CONTROL_PLANE_WRITE_DB_IDENTITY_NOT_DEDICATED";
    error.details = {
      dedicated_identity_required: true,
      runtime_identity_fallback_allowed: false,
      secrets_included: false,
    };
    throw error;
  }

  return {
    enabled: true,
    source: "dedicated_control_plane_write_db",
    host: String(env.CONTROL_PLANE_WRITE_DB_HOST).trim(),
    port: boundedInteger(env.CONTROL_PLANE_WRITE_DB_PORT, 3306, { min: 1, max: 65535 }),
    database: String(env.CONTROL_PLANE_WRITE_DB_NAME).trim(),
    user,
    password: String(env.CONTROL_PLANE_WRITE_DB_PASSWORD),
    waitForConnections: true,
    connectionLimit: boundedInteger(env.CONTROL_PLANE_WRITE_DB_CONNECTION_LIMIT, 2, { min: 1, max: 5 }),
    queueLimit: 0,
    connectTimeout: boundedInteger(env.CONTROL_PLANE_WRITE_DB_CONNECT_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

export function getControlPlaneWritePool(env = process.env) {
  if (!controlPlaneWriteAuthorityEnabled(env)) return getPool();
  if (!controlPlaneWritePool) controlPlaneWritePool = mysql.createPool(resolveControlPlaneWriteDbConfig(env));
  return controlPlaneWritePool;
}

export async function closeControlPlaneWritePool() {
  if (!controlPlaneWritePool) return;
  const current = controlPlaneWritePool;
  controlPlaneWritePool = null;
  await current.end();
}
