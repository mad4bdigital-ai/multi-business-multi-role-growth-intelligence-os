import { Router, urlencoded } from "express";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getPool } from "../db.js";
import { encryptCredentials } from "../tokenEncryption.js";
import { writeAuditLogAsync } from "../auditLogger.js";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 24 * 60;

const ALLOWED_AUTH_TYPES = new Set([
  "api_key",
  "webhook",
  "mcp",
  "basic_auth",
  "bearer_token",
  "oauth2",
  "custom_headers",
  "client_credentials",
]);

const ALLOWED_FIELD_TARGETS = new Set(["credentials", "connection", "metadata"]);
const ALLOWED_FIELD_TYPES = new Set(["text", "password", "url", "email", "number", "textarea", "select", "checkbox"]);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
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

function normalizeFieldName(name) {
  return String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function sanitizeField(raw = {}) {
  const name = normalizeFieldName(raw.name);
  if (!name) return null;
  const type = ALLOWED_FIELD_TYPES.has(raw.type) ? raw.type : (raw.secret ? "password" : "text");
  const target = ALLOWED_FIELD_TARGETS.has(raw.target) ? raw.target : "credentials";
  return {
    name,
    label: String(raw.label || name).slice(0, 120),
    type,
    target,
    required: raw.required !== false,
    secret: raw.secret !== false && target === "credentials",
    autocomplete: String(raw.autocomplete || (raw.secret === false ? "off" : "new-password")).slice(0, 64),
    placeholder: String(raw.placeholder || "").slice(0, 240),
    help: String(raw.help || "").slice(0, 240),
    options: Array.isArray(raw.options) ? raw.options.slice(0, 50).map((item) => ({
      value: String(item.value ?? item).slice(0, 120),
      label: String(item.label ?? item.value ?? item).slice(0, 120),
    })) : [],
  };
}

function defaultCredentialSchema(authType) {
  if (authType === "api_key") {
    return [
      { name: "api_key", label: "API key", type: "password", target: "credentials", required: true, secret: true },
      { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
    ];
  }
  if (authType === "bearer_token") {
    return [
      { name: "bearer_token", label: "Bearer token", type: "password", target: "credentials", required: true, secret: true },
      { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
    ];
  }
  if (authType === "mcp") {
    return [
      { name: "mcp_endpoint", label: "MCP endpoint URL", type: "url", target: "connection", required: true, secret: false },
      { name: "mcp_bearer", label: "MCP API key / bearer token", type: "password", target: "credentials", required: true, secret: true },
    ];
  }
  if (authType === "webhook") {
    return [
      { name: "webhook_url", label: "Webhook URL", type: "url", target: "connection", required: true, secret: false },
      { name: "webhook_secret", label: "Webhook secret", type: "password", target: "credentials", required: false, secret: true },
    ];
  }
  if (authType === "basic_auth") {
    return [
      { name: "username", label: "Username", type: "text", target: "credentials", required: true, secret: false, autocomplete: "username" },
      { name: "password", label: "Password", type: "password", target: "credentials", required: true, secret: true },
      { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
    ];
  }
  if (authType === "client_credentials") {
    return [
      { name: "client_id", label: "Client ID", type: "text", target: "credentials", required: true, secret: false },
      { name: "client_secret", label: "Client secret", type: "password", target: "credentials", required: true, secret: true },
      { name: "token_url", label: "Token URL", type: "url", target: "metadata", required: false, secret: false },
      { name: "scope", label: "Scope", type: "text", target: "metadata", required: false, secret: false },
    ];
  }
  if (authType === "custom_headers") {
    return [
      { name: "header_name", label: "Header name", type: "text", target: "metadata", required: true, secret: false },
      { name: "header_value", label: "Header value", type: "password", target: "credentials", required: true, secret: true },
      { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
    ];
  }
  if (authType === "oauth2") {
    return [];
  }
  return [];
}

function fieldsFromJsonSchema(schema = {}) {
  const props = schema && typeof schema === "object" && !Array.isArray(schema) ? schema.properties || {} : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map((v) => String(v || "")) : []);
  return Object.entries(props).map(([name, prop = {}]) => {
    const format = String(prop.format || "").trim().toLowerCase();
    const type = format === "password" ? "password" : prop.type === "boolean" ? "checkbox" : prop.type === "number" || prop.type === "integer" ? "number" : format === "uri" || format === "url" ? "url" : "text";
    const lowered = String(name || "").toLowerCase();
    const target = ["api_base_url", "mcp_endpoint", "webhook_url"].includes(name) ? "connection" : lowered.includes("scope") || lowered.includes("zone") || lowered.includes("label") ? "metadata" : "credentials";
    return {
      name,
      label: prop.title || name,
      type,
      target,
      required: required.has(name),
      secret: format === "password" || lowered.includes("token") || lowered.includes("secret") || lowered.includes("key"),
      placeholder: prop.description || "",
      help: prop.description || "",
      options: Array.isArray(prop.enum) ? prop.enum.map((value) => ({ value, label: value })) : [],
    };
  });
}

function normalizeCredentialSchema(authType, schema) {
  const rawFields = Array.isArray(schema?.fields)
    ? schema.fields
    : Array.isArray(schema)
      ? schema
      : schema?.properties
        ? fieldsFromJsonSchema(schema)
        : defaultCredentialSchema(authType);
  const fields = rawFields.map(sanitizeField).filter(Boolean);
  const seen = new Set();
  return fields.filter((field) => {
    if (seen.has(field.name)) return false;
    seen.add(field.name);
    return true;
  }).slice(0, 30);
}

function inputHtml(field, value = "") {
  const common = `name="${htmlEscape(field.name)}" ${field.required ? "required" : ""} autocomplete="${htmlEscape(field.autocomplete)}" placeholder="${htmlEscape(field.placeholder)}"`;
  if (field.type === "textarea") {
    return `<textarea ${common}>${htmlEscape(value)}</textarea>`;
  }
  if (field.type === "select") {
    const options = field.options.map((opt) => `<option value="${htmlEscape(opt.value)}">${htmlEscape(opt.label)}</option>`).join("");
    return `<select ${common}>${options}</select>`;
  }
  if (field.type === "checkbox") {
    return `<input ${common} type="checkbox" value="1">`;
  }
  return `<input ${common} type="${htmlEscape(field.type)}" value="${field.secret ? "" : htmlEscape(value)}">`;
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
    `SELECT * FROM credential_intake_sessions WHERE token_hash = ? LIMIT 1`,
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

function sessionSchema(session) {
  return normalizeCredentialSchema(session.auth_type, safeJsonParse(session.credential_schema_json, null));
}

function collectSubmission({ authType, schema, body = {}, session = {} }) {
  const credentials = {};
  const metadata = safeJsonParse(session.metadata_json, {}) || {};
  const connection = {
    mcp_endpoint: session.mcp_endpoint || null,
    webhook_url: session.webhook_url || null,
    api_base_url: session.api_base_url || null,
  };

  for (const field of schema) {
    const rawValue = field.type === "checkbox" ? (body[field.name] ? "1" : "") : String(body[field.name] || "").trim();
    if (field.required && !rawValue) {
      const err = new Error(`${field.name} is required.`);
      err.status = 400;
      err.code = "missing_credential_field";
      throw err;
    }
    if (!rawValue) continue;

    if (field.target === "credentials") credentials[field.name] = rawValue;
    else if (field.target === "connection") {
      if (["mcp_endpoint", "webhook_url", "api_base_url"].includes(field.name)) connection[field.name] = rawValue;
      else metadata[field.name] = rawValue;
    } else {
      metadata[field.name] = rawValue;
    }
  }

  const displayLabel = String(body.display_label || session.display_label || "").trim() || null;

  // Compatibility aliases used by existing app adapters and credential resolvers.
  if (authType === "api_key" && credentials.api_key) credentials.bearer_token = credentials.api_key;
  if (authType === "bearer_token" && credentials.bearer_token) credentials.api_key = credentials.bearer_token;
  if (authType === "mcp" && credentials.mcp_bearer) credentials.bearer_token = credentials.mcp_bearer;
  if (authType === "custom_headers" && credentials.header_value && metadata.header_name) {
    credentials.custom_headers = { [metadata.header_name]: credentials.header_value };
  }

  if (authType === "mcp" && !connection.mcp_endpoint) throw Object.assign(new Error("mcp_endpoint is required."), { status: 400 });
  if (authType === "webhook" && !connection.webhook_url) throw Object.assign(new Error("webhook_url is required."), { status: 400 });
  if (!Object.keys(credentials).length && authType !== "webhook") throw Object.assign(new Error("At least one credential secret is required."), { status: 400 });

  return { credentials, metadata, connection, displayLabel };
}

function renderCredentialForm({ session, app, error = "" }) {
  const fields = sessionSchema(session);
  const oauthNotice = session.auth_type === "oauth2"
    ? `<div class="meta">This app uses OAuth. Use the app authorization route instead of manual secret entry.</div>`
    : "";
  const fieldHtml = fields.map((field) => `
    <label>${htmlEscape(field.label)}${field.required ? "" : " <span class=\"optional\">optional</span>"}
      ${inputHtml(field)}
      ${field.help ? `<small>${htmlEscape(field.help)}</small>` : ""}
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
    main { width: min(640px, calc(100vw - 32px)); background: #fff; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { line-height: 1.55; color: #475569; }
    label { display: block; margin: 16px 0 6px; font-weight: 650; }
    input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; padding: 13px 14px; font: inherit; margin-top: 7px; }
    textarea { min-height: 96px; resize: vertical; }
    button { width: 100%; margin-top: 22px; border: 0; border-radius: 16px; padding: 14px 18px; font-weight: 700; background: #2563eb; color: white; cursor: pointer; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 12px 14px; margin: 18px 0; }
    .error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 14px; padding: 12px; }
    .optional, small { color: #64748b; font-weight: 500; font-size: 12px; display:block; margin-top:4px; }
    .fine { font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <h1>Secure credential intake</h1>
    <p>Enter credentials for <strong>${htmlEscape(app.display_name || session.app_key)}</strong>. Secrets are encrypted server-side and will not be shown again.</p>
    ${error ? `<div class="error">${htmlEscape(error)}</div>` : ""}
    <div class="meta">
      <div><strong>App:</strong> ${htmlEscape(session.app_key)}</div>
      <div><strong>Auth type:</strong> ${htmlEscape(session.auth_type)}</div>
      <div><strong>Expires:</strong> ${htmlEscape(new Date(session.expires_at).toISOString())}</div>
    </div>
    ${oauthNotice}
    <form method="post" autocomplete="off">
      ${fieldHtml}
      <label>Display label <span class="optional">optional</span><input name="display_label" type="text" value="${htmlEscape(session.display_label || "")}" autocomplete="off"></label>
      <button type="submit" ${session.auth_type === "oauth2" ? "disabled" : ""}>Save encrypted connection</button>
    </form>
    <p class="fine">This page is single-use and short-lived. The URL contains a one-time token; do not share it after submission.</p>
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

  // Browser form submissions are application/x-www-form-urlencoded. Keep this
  // local to credential-intake so JSON admin/API routes are unaffected.
  router.use("/credential-intake", urlencoded({ extended: false, limit: "64kb" }));

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
        credential_schema,
        metadata,
        expires_in_minutes,
        created_by,
      } = req.body || {};

      if (!user_id || !tenant_id || !app_key || !auth_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_required_fields", message: "user_id, tenant_id, app_key, auth_type are required." } });
      }
      if (!ALLOWED_AUTH_TYPES.has(String(auth_type))) {
        return res.status(400).json({ ok: false, error: { code: "unsupported_auth_type", message: "Unsupported auth_type." } });
      }

      const app = await loadApp(app_key);
      if (!app) return res.status(404).json({ ok: false, error: { code: "app_not_found", message: `App ${app_key} was not found.` } });

      const normalizedSchema = normalizeCredentialSchema(auth_type, credential_schema || null);
      if (auth_type !== "oauth2" && !normalizedSchema.length) {
        return res.status(400).json({ ok: false, error: { code: "empty_credential_schema", message: "No credential fields are available for this auth_type." } });
      }

      const sessionId = randomUUID();
      const token = randomToken();
      const tokenHash = sha256(token);
      const ttl = clampTtlMinutes(expires_in_minutes);
      const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString().slice(0, 19).replace("T", " ");

      await getPool().query(
        `INSERT INTO credential_intake_sessions
           (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
            mcp_endpoint, webhook_url, api_base_url, workspace_id, credential_schema_json,
            metadata_json, status, expires_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
        [sessionId, tokenHash, user_id, tenant_id, app_key, auth_type, display_label || null,
         mcp_endpoint || null, webhook_url || null, api_base_url || null, workspace_id || null,
         JSON.stringify({ fields: normalizedSchema }), JSON.stringify(metadata || {}), expiresAt, created_by || req?.auth?.user_id || null]
      );

      const intakeUrl = `${absoluteBaseUrl(req)}/credential-intake/${encodeURIComponent(token)}`;
      return res.status(201).json({ ok: true, session_id: sessionId, intake_url: intakeUrl, expires_at: expiresAt, app_key, auth_type, field_count: normalizedSchema.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "credential_intake_session_create_failed", message: err.message } });
    }
  });

  router.get("/credential-intake/:token/schema", async (req, res) => {
    noStoreHeaders(res);
    const loaded = await loadPendingSession(req.params.token);
    if (!loaded.ok) return res.status(loaded.status).json({ ok: false, error: loaded.error });
    const app = await loadApp(loaded.session.app_key);
    return res.json({
      ok: true,
      app: app ? { app_key: app.app_key, display_name: app.display_name, category: app.category, auth_type: app.auth_type } : null,
      session: {
        app_key: loaded.session.app_key,
        auth_type: loaded.session.auth_type,
        expires_at: loaded.session.expires_at,
        fields: sessionSchema(loaded.session).map((field) => ({ ...field, secret: !!field.secret })),
      },
    });
  });

  router.get("/credential-intake/:token", async (req, res) => {
    noStoreHeaders(res);
    try {
      const loaded = await loadPendingSession(req.params.token);
      if (!loaded.ok) return res.status(loaded.status).type("text").send(loaded.error);
      const app = await loadApp(loaded.session.app_key);
      return res.status(200).type("html").send(renderCredentialForm({ session: loaded.session, app: app || {} }));
    } catch {
      return res.status(500).type("text").send("Credential intake page failed.");
    }
  });

  router.post("/credential-intake/:token", async (req, res) => {
    noStoreHeaders(res);
    try {
      const loaded = await loadPendingSession(req.params.token);
      if (!loaded.ok) return res.status(loaded.status).type("text").send(loaded.error);
      const session = loaded.session;
      const schema = sessionSchema(session);
      const { credentials, metadata, connection, displayLabel } = collectSubmission({ authType: session.auth_type, schema, body: req.body || {}, session });

      const connectionId = randomUUID();
      await getPool().query(
        `INSERT INTO user_app_connections
           (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
            encrypted_credentials, account_label, account_metadata,
            mcp_endpoint, webhook_url, api_base_url, is_primary, status, validation_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active','pending_validation')`,
        [connectionId, session.user_id, session.tenant_id, session.app_key, displayLabel,
         session.auth_type, encryptCredentials(credentials), displayLabel || connection.api_base_url || connection.mcp_endpoint || connection.webhook_url || null,
         JSON.stringify({ ...metadata, intake_session_id: session.session_id, intake_type: "schema_driven_web_form" }),
         connection.mcp_endpoint, connection.webhook_url, connection.api_base_url]
      );

      await getPool().query(
        `UPDATE credential_intake_sessions
            SET status = 'used', used_at = NOW(), connection_id = ?
          WHERE session_id = ?`,
        [connectionId, session.session_id]
      );

      writeAuditLogAsync({
        tenant_id: session.tenant_id,
        actor_id: session.user_id,
        actor_type: "credential_intake_link",
        action: "credential_intake.connection_created",
        resource_type: "user_app_connection",
        resource_id: connectionId,
        after_json: {
          app_key: session.app_key,
          auth_type: session.auth_type,
          field_count: schema.length,
          has_mcp_endpoint: !!connection.mcp_endpoint,
          has_webhook_url: !!connection.webhook_url,
          has_api_base_url: !!connection.api_base_url,
        },
        ip_address: req.ip,
        user_agent: req.headers["user-agent"] || null,
      });

      return res.status(201).type("html").send(renderDone(connectionId));
    } catch (err) {
      const loaded = await loadPendingSession(req.params.token).catch(() => null);
      const app = loaded?.session ? await loadApp(loaded.session.app_key).catch(() => ({})) : {};
      return res.status(err.status || 500).type("html").send(renderCredentialForm({
        session: loaded?.session || { app_key: "unknown", auth_type: "api_key", expires_at: new Date().toISOString(), credential_schema_json: JSON.stringify({ fields: defaultCredentialSchema("api_key") }) },
        app: app || {},
        error: err.message || "Failed to save credentials.",
      }));
    }
  });

  return router;
}
