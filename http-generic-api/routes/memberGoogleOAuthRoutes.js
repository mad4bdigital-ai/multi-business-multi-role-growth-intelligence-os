import express from "express";
import crypto from "node:crypto";
import { getPool } from "../db.js";
import { buildEncryptedCredentialsForStorage, normalizeEmailKey } from "../userAppConnectionCredentials.js";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`Missing required field: ${name}`);
    err.status = 400;
    err.code = "missing_required_field";
    throw err;
  }
  return normalized;
}

function splitScopes(value = "") {
  if (Array.isArray(value)) return value.map(v => String(v || "").trim()).filter(Boolean);
  return String(value || "").split(/[,\s|]+/).map(v => v.trim()).filter(Boolean);
}

function normalizeScopes(value = "") {
  return [...new Set(splitScopes(value))].join(" ");
}

function sanitizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

async function resolveUser({ user_id = "", email = "" } = {}) {
  const pool = getPool();
  if (user_id) {
    const [rows] = await pool.query("SELECT user_id, email, tenant_id FROM users WHERE CAST(user_id AS CHAR)=CAST(? AS CHAR) LIMIT 1", [user_id]);
    return rows?.[0] || null;
  }
  const normalizedEmail = sanitizeEmail(email);
  if (!normalizedEmail) return null;
  const [rows] = await pool.query("SELECT user_id, email, tenant_id FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1", [normalizedEmail]);
  return rows?.[0] || null;
}

async function upsertConnection({ user, body }) {
  const pool = getPool();
  const appKey = String(body.app_key || "google_cloud").trim();
  const accountLabel = sanitizeEmail(body.account_label || body.email || user.email);
  const scopesGranted = normalizeScopes(body.scopes_granted || body.scopes || "");
  const refreshToken = required(body.refresh_token, "refresh_token");
  const credentials = {
    refresh_token: refreshToken,
    client_id: String(body.client_id || "").trim() || undefined,
    client_secret: String(body.client_secret || "").trim() || undefined,
    token_uri: String(body.token_uri || "https://oauth2.googleapis.com/token").trim(),
    account_label: accountLabel,
    member_email: sanitizeEmail(user.email),
    source: "admin_member_google_oauth_connection"
  };
  const encrypted = buildEncryptedCredentialsForStorage(credentials);
  const tenantId = String(body.tenant_id || user.tenant_id || "").trim();
  const now = new Date();
  const tokenExpiresAt = body.token_expires_at ? new Date(body.token_expires_at) : null;

  const [existing] = await pool.query(
    "SELECT connection_id FROM user_app_connections WHERE CAST(user_id AS CHAR)=CAST(? AS CHAR) AND app_key=? AND account_label=? ORDER BY is_primary DESC, connected_at DESC LIMIT 1",
    [user.user_id, appKey, accountLabel]
  );

  if (existing?.[0]?.connection_id) {
    await pool.query(
      `UPDATE user_app_connections
          SET tenant_id=?, auth_type='oauth2', encrypted_credentials=?, token_expires_at=?, scopes_granted=?, account_metadata=?, is_primary=?, status='active', last_used_at=NULL
        WHERE connection_id=?`,
      [tenantId, encrypted, tokenExpiresAt, scopesGranted, JSON.stringify({ email_key: normalizeEmailKey(accountLabel), linked_by: "admin_member_google_oauth_connection", updated_at: now.toISOString() }), body.is_primary === false ? 0 : 1, existing[0].connection_id]
    );
    return { operation: "updated", connection_id: existing[0].connection_id };
  }

  const connectionId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO user_app_connections
      (connection_id, user_id, tenant_id, app_key, display_label, auth_type, encrypted_credentials, token_expires_at, scopes_granted, account_label, account_metadata, is_primary, status, connected_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, 'oauth2', ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)`,
    [connectionId, user.user_id, tenantId, appKey, String(body.display_label || "Google Cloud OAuth").trim(), encrypted, tokenExpiresAt, scopesGranted, accountLabel, JSON.stringify({ email_key: normalizeEmailKey(accountLabel), linked_by: "admin_member_google_oauth_connection", created_at: now.toISOString() }), body.is_primary === false ? 0 : 1]
  );
  return { operation: "inserted", connection_id: connectionId };
}

export function buildMemberGoogleOAuthRoutes(deps = {}) {
  const router = express.Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((req, res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((req, res, next) => next());

  router.post("/admin/oauth/google/member-connection", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const body = req.body || {};
      const user = await resolveUser({ user_id: body.user_id, email: body.email || body.member_email });
      if (!user) {
        return res.status(404).json({ ok: false, error: { code: "member_not_found", message: "No platform user found for supplied user_id/email.", status: 404 } });
      }
      const result = await upsertConnection({ user, body });
      res.json({
        ok: true,
        ...result,
        user_id: user.user_id,
        member_email: user.email,
        app_key: String(body.app_key || "google_cloud").trim(),
        account_label: sanitizeEmail(body.account_label || body.email || user.email),
        scopes_granted: normalizeScopes(body.scopes_granted || body.scopes || ""),
        credential_stored: true
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "member_google_oauth_connection_failed", message: error.message || String(error), status: error.status || 500 } });
    }
  });

  return router;
}
