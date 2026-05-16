import { Router } from "express";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getPool } from "../db.js";
import { encryptCredentials } from "../tokenEncryption.js";
import { writeAuditLogAsync } from "../auditLogger.js";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 24 * 60;
const ALLOWED_AUTH_TYPES = new Set(["api_key", "webhook", "mcp", "basic_auth", "bearer_token"]);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clampTtlMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MINUTES;
  return Math.min(Math.max(parsed, 1), MAX_TTL_MINUTES);
}

function randomToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

async function loadApp(appKey) {
  const [rows] = await getPool().query(
    "SELECT app_key, display_name, description, auth_type, category, status FROM `app_integrations` WHERE app_key = ? LIMIT 1",
    [appKey]
  );
  return rows[0] || null;
}

async function loadPendingSession(token) {
  const tokenHash = sha256(token);
  const [rows] = await getPool().query(
    `SELECT * FROM credential_intake_sessions
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash]
  );
  const session = rows[0] || null;
  if (!session) return { ok: false, status: 404, error: "credential_intake_session_not_found" };
  if (session.status !== "pending") return { ok: false, status: 410, error: `credential_intake_session_${session.status}` };
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await getPool().query("UPDATE credential_intake_sessions SET status = 'expired' WHERE session_id = ?", [session.session_id]);
    return { ok: false, status: 410, error: "credential_intake_session_expired" };
  }
  return { ok: true, session };
}

function credentialFieldsFor(authType) {
  if (authType === "api_key") {
    return [{ name: "api_key", label: "API key", type: "password", required: true, autocomplete: "new-password" }];
  }
  if (authType === "bearer_token") {
    return [{ name: "bearer_token", label: "Bearer token", type: "password", required: true, autocomplete: "new-password" }];
  }
  if (authType === "mcp") {
    return [{ name: "mcp_bearer", label: "MCP API key / bearer token", type: "password", required: true, autocomplete: "new-password" }];
  }
  if (authType === "webhook") {
    return [{ name: "webhook_secret", label: "Webhook secret", type: "password", required: false, autocomplete: "new-password" }];
  }
  if (authType === "basic_auth") {
    return [
      { name: "username", label: "Username", type: "text", required: true, autocomplete: "username" },
      { name: "password", label: "Password", type: "password", required: true, autocomplete: "new-password" },
    ];
  }
  return [];
}

function collectCredentials(authType, body = {}) {
  const credentials = {};
  for (const field of credentialFieldsFor(authType)) {
    const value = String(body[field.name] || "").trim();
    if (field.required && !value) {
      const err = new Error(`${field.name} is required.`);
      err.status = 400;
      err.code = "missing_credential_field";
      throw err;
    }
    if (value) credentials[field.name] = value;
  }

  if (authType === "api_key" && credentials.api_key) credentials.bearer_token = credentials.api_key;
  if (authType === "bearer_token" && credentials.bearer_token) credentials.api_key = credentials.bearer_token;
  if (authType === "mcp" && credentials.mcp_bearer) credentials.bearer_token = credentials.mcp_bearer;
  return credentials;
}

function noStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
}

function renderCredentialForm({ session, app, error = "" }) {
  const authType = session.auth_type;
  const fields = credentialFieldsFor(authType);
  const endpointField = authType === "mcp" && !session.mcp_endpoint
    ? `<label>MCP endpoint URL<input name="mcp_endpoint" type="url" required placeholder="https://..." autocomplete="off"></label>`
    : "";
  const webhookField = authType === "webhook" && !session.webhook_url
    ? `<label>Webhook URL<input name="webhook_url" type="url" required placeholder="https://..." autocomplete="off"></label>`
    : "";
  const apiBaseField = !session.api_base_url && ["api_key", "bearer_token"].includes(authType)
    ? `<label>API base URL <span class="optional">optional</span><input name="api_base_url" type="url" placeholder="https://api.example.com" autocomplete="off"></label>`
    : "";

  const fieldHtml = fields.map((field) => `
    <label>${htmlEscape(field.label)}${field.required ? "" : " <span class=\"optional\">optional</span>"}
      <input name="${htmlEscape(field.name)}" type="${htmlEscape(field.type)}" ${field.required ? "required" : ""} autocomplete="${htmlEscape(field.autocomplete)}">
    </label>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Secure credential intake</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #0f172a; }
    main { width: min(560px, calc(100vw - 32px)); background: #fff; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { line-height: 1.55; color: #475569; }
    label { display: block; margin: 16px 0 6px; font-weight: 650; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; padding: 13px 14px; font: inherit; margin-top: 7px; }
    button { width: 100%; margin-top: 22px; border: 0; border-radius: 16px; padding: 14px 18px; font-weight: 700; background: #2563eb; color: white; cursor: pointer; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 12px 14px; margin: 18px 0; }
    .error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 14px; padding: 12px; }
    .optional { color: #64748b; font-weight: 500; font-size: 12px; }
    .fine { font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <h1>Secure credential intake</h1>
    <p>Enter credentials for <strong>${htmlEscape(app.display_name || session.app_key)}</strong>. The secret is encrypted server-side and will not be shown again.</p>
    ${error ? `<div class="error">${htmlEscape(error)}</div>` : ""}
    <div class="meta">
      <div><strong>App:</strong> ${htmlEscape(session.app_key)}</div>
      <div><strong>Auth type:</strong> ${htmlEscape(authType)}</div>
      <div><strong>Expires:</strong> ${htmlEscape(new Date(session.expires_at).toISOString())}</div>
    </div>
    <form method="post" autocomplete="off">
      ${fieldHtml}
      ${endpointField}
      ${webhookField}
      ${apiBaseField}
      <label>Display label <span class="optional">optional</span><input name="display_label" type="text" value="${htmlEscape(session.display_label || "")}" autocomplete="off"></label>
      <button type="submit">Save encrypted connection</button>
    </form>
    <p class="fine">This page is single-use and short-lived. Do not share the URL after submission.</p>
  </main>
</body>
</html>`;
}

function renderDone(connectionId) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connection saved</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a}main{background:white;padding:28px;border-radius:24px;max-width:560px}code{background:#f1f5f9;padding:3px 6px;border-radius:8px}</style></head><body><main><h1>Connection saved</h1><p>The credential was encrypted and stored successfully.</p><p>Connection ID: <code>${htmlEscape(connectionId)}</code></p><p>You can close this page.</p></main></body></html>`;
}

function absoluteBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function buildCredentialIntakeRoutes(deps = {}) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.post("/credential-intake/sessions", requireBackendApiKey, async (req, res) => {
    try {
      const {
        user_id,
        tenant_id,
        app_key,
        auth_type,
        display_label,
        mcp_endpoint,
        webhook_url,
        api_base_url,
        workspace_id,
        expires_in_minutes,
        created_by,
      } = req.body || {};

      if (!user_id || !tenant_id || !app_key || !auth_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_required_fields", message: "user_id, tenant_id, app_key, auth_type are required." } });
      }
      if (!ALLOWED_AUTH_TYPES.has(String(auth_type))) {
        return res.status(400).json({ ok: false, error: { code: "unsupported_auth_type", message: "auth_type must be one of api_key, webhook, mcp, basic_auth, bearer_token." } });
      }

      const app = await loadApp(app_key);
      if (!app) return res.status(404).json({ ok: false, error: { code: "app_not_found", message: `App ${app_key} was not found.` } });

      const sessionId = randomUUID();
      const token = randomToken();
      const tokenHash = sha256(token);
      const ttl = clampTtlMinutes(expires_in_minutes);
      const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString().slice(0, 19).replace("T", " ");

      await getPool().query(
        `INSERT INTO credential_intake_sessions
           (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
            mcp_endpoint, webhook_url, api_base_url, workspace_id, status, expires_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
        [sessionId, tokenHash, user_id, tenant_id, app_key, auth_type, display_label || null,
         mcp_endpoint || null, webhook_url || null, api_base_url || null, workspace_id || null, expiresAt, created_by || req?.auth?.user_id || null]
      );

      const intakeUrl = `${absoluteBaseUrl(req)}/credential-intake/${encodeURIComponent(token)}`;
      return res.status(201).json({ ok: true, session_id: sessionId, intake_url: intakeUrl, expires_at: expiresAt, app_key, auth_type });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "credential_intake_session_create_failed", message: err.message } });
    }
  });

  router.get("/credential-intake/:token", async (req, res) => {
    noStoreHeaders(res);
    try {
      const loaded = await loadPendingSession(req.params.token);
      if (!loaded.ok) return res.status(loaded.status).send(renderCredentialForm({ session: { app_key: "expired", auth_type: "api_key", expires_at: new Date().toISOString() }, app: { display_name: "Expired session" }, error: loaded.error }));
      const app = await loadApp(loaded.session.app_key);
      return res.status(200).type("html").send(renderCredentialForm({ session: loaded.session, app: app || {} }));
    } catch (err) {
      return res.status(500).type("text").send("Credential intake page failed.");
    }
  });

  router.post("/credential-intake/:token", async (req, res) => {
    noStoreHeaders(res);
    try {
      const loaded = await loadPendingSession(req.params.token);
      if (!loaded.ok) return res.status(loaded.status).type("text").send(loaded.error);
      const session = loaded.session;
      const app = await loadApp(session.app_key);
      const credentials = collectCredentials(session.auth_type, req.body || {});
      const mcpEndpoint = String(req.body?.mcp_endpoint || session.mcp_endpoint || "").trim() || null;
      const webhookUrl = String(req.body?.webhook_url || session.webhook_url || "").trim() || null;
      const apiBaseUrl = String(req.body?.api_base_url || session.api_base_url || "").trim() || null;
      const displayLabel = String(req.body?.display_label || session.display_label || "").trim() || null;

      if (session.auth_type === "mcp" && !mcpEndpoint) throw Object.assign(new Error("mcp_endpoint is required."), { status: 400 });
      if (session.auth_type === "webhook" && !webhookUrl) throw Object.assign(new Error("webhook_url is required."), { status: 400 });

      const connectionId = randomUUID();
      await getPool().query(
        `INSERT INTO user_app_connections
           (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
            encrypted_credentials, account_label, account_metadata,
            mcp_endpoint, webhook_url, api_base_url, is_primary, status, validation_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active','pending_validation')`,
        [connectionId, session.user_id, session.tenant_id, session.app_key, displayLabel,
         session.auth_type, encryptCredentials(credentials), displayLabel || apiBaseUrl || mcpEndpoint || webhookUrl || null,
         JSON.stringify({ intake_session_id: session.session_id, intake_type: "web_form" }),
         mcpEndpoint, webhookUrl, apiBaseUrl]
      );

      await getPool().query(
        `UPDATE credential_intake_sessions
            SET status = 'used', used_at = NOW(), connection_id = ?
          WHERE session_id = ?`,
        [connectionId, session.session_id]
      );

      writeAuditLogAsync?.({
        tenant_id: session.tenant_id,
        actor_id: session.user_id,
        actor_type: "credential_intake_link",
        action: "credential_intake.connection_created",
        resource_type: "user_app_connection",
        resource_id: connectionId,
        after_json: { app_key: session.app_key, auth_type: session.auth_type, has_mcp_endpoint: !!mcpEndpoint, has_webhook_url: !!webhookUrl, has_api_base_url: !!apiBaseUrl },
      });

      return res.status(201).type("html").send(renderDone(connectionId));
    } catch (err) {
      const loaded = await loadPendingSession(req.params.token).catch(() => null);
      const app = loaded?.session ? await loadApp(loaded.session.app_key).catch(() => ({})) : {};
      return res.status(err.status || 500).type("html").send(renderCredentialForm({
        session: loaded?.session || { app_key: "unknown", auth_type: "api_key", expires_at: new Date().toISOString() },
        app: app || {},
        error: err.message || "Failed to save credentials.",
      }));
    }
  });

  return router;
}
