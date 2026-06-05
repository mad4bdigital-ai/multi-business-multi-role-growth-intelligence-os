import { Router } from "express";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { getPool } from "../db.js";
import { decryptCredentials } from "../tokenEncryption.js";

function verifyUserJwt(authorization) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "dev-secret");
  } catch {
    return null;
  }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

function normalizeAuthKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  if (["database", "db", "remote_database", "mysql"].includes(value)) return "remote_database";
  if (["ssh", "ssh_key_pair", "remote_ssh_runtime"].includes(value)) return "ssh_key_pair";
  return value;
}

function expectedAppKey(authType) {
  if (authType === "remote_database") return "remote_mysql_database";
  if (authType === "ssh_key_pair") return "remote_ssh_runtime";
  return null;
}

function safeConnection(row) {
  return {
    connection_id: row.connection_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    app_key: row.app_key,
    auth_type: row.auth_type,
    display_label: row.display_label,
    account_label: row.account_label,
    status: row.status,
    validation_status: row.validation_status,
    connected_at: row.connected_at,
    last_validated_at: row.last_validated_at,
    last_used_at: row.last_used_at,
  };
}

function readinessFor(row, expectedAuthType) {
  const checks = {
    tenant_scoped: Boolean(row?.tenant_id && row?.user_id),
    connection_active: row?.status === "active",
    auth_type_matches: row?.auth_type === expectedAuthType,
    app_key_matches: row?.app_key === expectedAppKey(expectedAuthType),
    credentials_present: Boolean(row?.encrypted_credentials),
    not_revoked: row?.status !== "revoked",
  };
  const ready = Object.values(checks).every(Boolean);
  const blocked = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    ready,
    checks,
    blocked_reasons: blocked,
    execution_enabled: false,
    execution_next_step: expectedAuthType === "ssh_key_pair"
      ? "tenant_ssh_allowlisted_runtime_tools_not_enabled_yet"
      : "tenant_database_runtime_tools_not_enabled_yet",
    secrets_included: false,
  };
}

async function loadTenantConnection(pool, req, connectionId, expectedAuthType) {
  if (!req.auth?.tenant_id) {
    const err = new Error("A tenant-scoped user JWT is required.");
    err.status = 401;
    err.code = "tenant_auth_required";
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT connection_id, user_id, tenant_id, app_key, auth_type, display_label,
            account_label, encrypted_credentials, status, validation_status,
            connected_at, last_validated_at, last_used_at
       FROM user_app_connections
      WHERE connection_id = ?
        AND tenant_id = ?
        AND user_id = ?
      LIMIT 1`,
    [connectionId, req.auth.tenant_id, req.auth.user_id]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("Connection was not found for this caller.");
    err.status = 404;
    err.code = "connection_not_found";
    throw err;
  }
  if (row.auth_type !== expectedAuthType) {
    const err = new Error(`Connection auth_type ${row.auth_type} is not ${expectedAuthType}.`);
    err.status = 409;
    err.code = "connection_auth_type_mismatch";
    throw err;
  }
  return row;
}

export function buildTenantInfrastructureRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool || { query: (...args) => getPool().query(...args) };

  async function sendStatus(req, res, authType) {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      return res.json({
        ok: true,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness: readinessFor(row, authType),
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_status_failed", message: err.message }, secrets_included: false });
    }
  }

  async function sendPreflight(req, res, authType) {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      const readiness = readinessFor(row, authType);
      return res.json({
        ok: true,
        dry_run: true,
        will_decrypt_credentials: false,
        will_open_network_connection: false,
        will_execute_command: false,
        will_query_database: false,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness,
        allowed_next_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_connection_status", "tenant_ssh_preflight"]
          : ["tenant_database_connection_status", "tenant_database_preflight"],
        blocked_runtime_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_cli_allowlisted_execute"]
          : ["tenant_database_schema_read", "tenant_database_query_readonly"],
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_preflight_failed", message: err.message }, secrets_included: false });
    }
  }

  router.get("/me/infrastructure/database/connections/:connection_id/status", requireUserJwt, (req, res) => sendStatus(req, res, "remote_database"));
  router.post("/me/infrastructure/database/connections/:connection_id/preflight", requireUserJwt, (req, res) => sendPreflight(req, res, "remote_database"));
  router.get("/me/infrastructure/ssh/connections/:connection_id/status", requireUserJwt, (req, res) => sendStatus(req, res, "ssh_key_pair"));
  router.post("/me/infrastructure/ssh/connections/:connection_id/preflight", requireUserJwt, (req, res) => sendPreflight(req, res, "ssh_key_pair"));

  router.get("/me/infrastructure/connections/:connection_id/status", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      const authType = normalizeAuthKind(req.query.auth_type || req.query.kind);
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!["remote_database", "ssh_key_pair"].includes(authType)) {
        return res.status(400).json({ ok: false, error: { code: "auth_type_required", message: "auth_type must be remote_database or ssh_key_pair." }, secrets_included: false });
      }
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      return res.json({
        ok: true,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness: readinessFor(row, authType),
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_status_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/infrastructure/connections/:connection_id/preflight", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      const authType = normalizeAuthKind(req.body?.auth_type || req.body?.kind);
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!["remote_database", "ssh_key_pair"].includes(authType)) {
        return res.status(400).json({ ok: false, error: { code: "auth_type_required", message: "auth_type must be remote_database or ssh_key_pair." }, secrets_included: false });
      }
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      const readiness = readinessFor(row, authType);
      return res.json({
        ok: true,
        dry_run: true,
        will_decrypt_credentials: false,
        will_open_network_connection: false,
        will_execute_command: false,
        will_query_database: false,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness,
        allowed_next_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_connection_status", "tenant_ssh_preflight"]
          : ["tenant_database_connection_status", "tenant_database_preflight"],
        blocked_runtime_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_cli_allowlisted_execute"]
          : ["tenant_database_schema_read", "tenant_database_query_readonly"],
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_preflight_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
