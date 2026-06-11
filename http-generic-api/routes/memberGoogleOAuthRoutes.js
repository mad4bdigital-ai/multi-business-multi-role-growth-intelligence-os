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

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || process.env.AUTH_BASE_URL || "https://auth.mad4b.com").replace(/\/+$/, "");
}

function gmailRedirectUri() {
  return String(process.env.GOOGLE_GMAIL_SEND_REDIRECT_URI || `${publicBaseUrl()}/oauth/google/gmail-send/callback`).trim();
}

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || "").trim();
}

function googleClientSecret() {
  return String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

function oauthStateSecret() {
  return String(process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || process.env.BACKEND_API_KEY || process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

function base64UrlJson(value = {}) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64UrlJson(value = "") {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function signStatePayload(payload = {}) {
  const secret = oauthStateSecret();
  if (!secret) {
    const err = new Error("OAuth state signing secret is not configured.");
    err.status = 503;
    err.code = "oauth_state_secret_missing";
    throw err;
  }
  const body = base64UrlJson(payload);
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyStateToken(state = "") {
  const secret = oauthStateSecret();
  const [body, sig] = String(state || "").split(".");
  if (!secret || !body || !sig) {
    const err = new Error("Invalid OAuth state.");
    err.status = 400;
    err.code = "oauth_state_invalid";
    throw err;
  }
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    const err = new Error("OAuth state signature mismatch.");
    err.status = 400;
    err.code = "oauth_state_signature_invalid";
    throw err;
  }
  const payload = parseBase64UrlJson(body);
  if (!payload.exp || Number(payload.exp) < Date.now()) {
    const err = new Error("OAuth state expired.");
    err.status = 400;
    err.code = "oauth_state_expired";
    throw err;
  }
  return payload;
}

function requestedGmailScopes(extraScopes = "") {
  return normalizeScopes(`${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email ${extraScopes || ""}`);
}

function buildGmailAuthorizationUrl({ user_id = "", email = "", tenant_id = "", account_label = "", app_key = "gmail_user_oauth", scopes = "" } = {}) {
  const clientId = googleClientId();
  if (!clientId) {
    const err = new Error("GOOGLE_CLIENT_ID is not configured.");
    err.status = 503;
    err.code = "google_oauth_client_id_missing";
    throw err;
  }
  const scope = requestedGmailScopes(scopes);
  const state = signStatePayload({
    purpose: "support_ticket_gmail_send_oauth",
    user_id: String(user_id || ""),
    email: sanitizeEmail(email),
    tenant_id: String(tenant_id || ""),
    account_label: sanitizeEmail(account_label || email),
    app_key: String(app_key || "gmail_user_oauth").trim(),
    scopes: scope,
    nonce: crypto.randomUUID(),
    iat: Date.now(),
    exp: Date.now() + 15 * 60 * 1000,
  });
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", gmailRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return { authorization_url: url.toString(), redirect_uri: gmailRedirectUri(), scopes: scope, state_expires_in_seconds: 900 };
}

async function exchangeGmailAuthorizationCode(code = "") {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    const err = new Error("Google OAuth client id/secret are not configured.");
    err.status = 503;
    err.code = "google_oauth_client_credentials_missing";
    throw err;
  }
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(code || ""),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.refresh_token) {
    const err = new Error(token.error_description || token.error || "Google OAuth token exchange failed or returned no refresh token.");
    err.status = response.status || 400;
    err.code = "google_gmail_oauth_token_exchange_failed";
    err.details = { has_refresh_token: Boolean(token.refresh_token), secrets_included: false };
    throw err;
  }
  return token;
}

async function resolveUser({ user_id = "", email = "" } = {}) {
  const pool = getPool();
  if (user_id) {
    const [rows] = await pool.query("SELECT user_id, email FROM users WHERE CAST(user_id AS CHAR)=CAST(? AS CHAR) LIMIT 1", [user_id]);
    return rows?.[0] || null;
  }
  const normalizedEmail = sanitizeEmail(email);
  if (!normalizedEmail) return null;
  const [rows] = await pool.query("SELECT user_id, email FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1", [normalizedEmail]);
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
  const tenantId = String(body.tenant_id || "").trim();
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
