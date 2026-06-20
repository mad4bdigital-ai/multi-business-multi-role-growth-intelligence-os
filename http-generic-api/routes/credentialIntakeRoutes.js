import { Router, urlencoded } from "express";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getPool } from "../db.js";
import { encryptCredentials, encryptToken } from "../tokenEncryption.js";
import { writeAuditLogAsync } from "../auditLogger.js";
import { enqueueCredentialIntakeCompletedWebhook } from "../webhookDeliveryDispatcher.js";
import { atomicallyConsumeCredentialIntakeSession } from "../credentialIntakeSingleUse.js";
import {
  buildCredentialIntakeBinding,
  normalizeCredentialIntakeRedirect,
  validateCredentialIntakeSessionSecurity,
} from "../credentialIntakeBindingPolicy.js";

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
  "ssh_key_pair",
  "remote_database",
]);

const ALLOWED_FIELD_TARGETS = new Set(["credentials", "connection", "metadata"]);
const ALLOWED_FIELD_TYPES = new Set(["text", "password", "url", "email", "number", "textarea", "json", "select", "checkbox"]);

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
  if (authType === "ssh_key_pair") {
    return [
      { name: "ssh_host", label: "SSH host", type: "text", target: "credentials", required: true, secret: false, autocomplete: "off" },
      { name: "ssh_port", label: "SSH port", type: "number", target: "credentials", required: true, secret: false, autocomplete: "off" },
      { name: "ssh_user", label: "SSH username", type: "text", target: "credentials", required: true, secret: false, autocomplete: "username" },
      { name: "ssh_private_key", label: "SSH private key", type: "textarea", target: "credentials", required: true, secret: true, autocomplete: "new-password", help: "Paste the private key. It is encrypted server-side and never shown again." },
    ];
  }
  if (authType === "remote_database") {
    return [
      { name: "db_host", label: "DB_HOST", type: "text", target: "credentials", required: true, secret: false, autocomplete: "off" },
      { name: "db_port", label: "DB_PORT", type: "number", target: "credentials", required: true, secret: false, autocomplete: "off" },
      { name: "db_name", label: "DB_NAME", type: "text", target: "credentials", required: true, secret: false, autocomplete: "off" },
      { name: "db_user", label: "DB_USER", type: "text", target: "credentials", required: true, secret: false, autocomplete: "username" },
      { name: "db_password", label: "DB_PASSWORD", type: "password", target: "credentials", required: true, secret: true, autocomplete: "new-password" },
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
  if (field.type === "textarea" || field.type === "json") {
    const rows = field.type === "json" ? "10" : "";
    const accept = field.type === "json"
      ? `<input class="json-file" type="file" accept="application/json,.json" data-target="${htmlEscape(field.name)}">`
      : "";
    return `${accept}<textarea ${common} ${rows ? `rows="${rows}"` : ""}>${htmlEscape(value)}</textarea>`;
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

async function loadApp(appKey, pool = getPool()) {
  const [rows] = await pool.query(
    "SELECT app_key, display_name, description, auth_type, category, status, credential_intake_redirect_allowlist_json FROM `app_integrations` WHERE app_key = ? LIMIT 1",
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

function parseJsonCredentialField(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 64 * 1024) {
    const err = new Error(`${fieldName} is too large. Maximum size is 64KB.`);
    err.status = 400;
    err.code = "json_credential_too_large";
    throw err;
  }
  try { return JSON.parse(raw); }
  catch {
    const err = new Error(`${fieldName} must be valid JSON.`);
    err.status = 400;
    err.code = "invalid_json_credential";
    throw err;
  }
}

function extractMcpServersConfig(value) {
  const parsed = parseJsonCredentialField(value, "mcp_servers_json");
  if (!parsed) return null;
  const servers = parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
    ? parsed.mcpServers
    : null;
  if (!servers || !Object.keys(servers).length) {
    const err = new Error("mcp_servers_json must contain an mcpServers object.");
    err.status = 400;
    err.code = "invalid_mcp_servers_json";
    throw err;
  }
  const [serverName, server] = Object.entries(servers)[0];
  if (!server || typeof server !== "object" || !server.url) {
    const err = new Error("mcpServers entries must include a url.");
    err.status = 400;
    err.code = "invalid_mcp_server_entry";
    throw err;
  }
  const auth = String(server.headers?.Authorization || server.headers?.authorization || "").trim();
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  return {
    raw: parsed,
    serverName,
    server,
    endpoint: String(server.url || "").trim(),
    transport: String(server.type || "http").trim() || "http",
    bearer,
  };
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

    if (authType === "mcp" && field.name === "mcp_servers_json") {
      const config = extractMcpServersConfig(rawValue);
      credentials.mcp_servers_json = JSON.stringify(config.raw);
      credentials.mcp_servers = config.raw.mcpServers;
      if (config.bearer) {
        credentials.mcp_bearer = config.bearer;
        credentials.bearer_token = config.bearer;
      }
      connection.mcp_endpoint = config.endpoint;
      metadata.mcp_server_name = config.serverName;
      metadata.mcp_transport = config.transport;
      continue;
    }

    if (field.type === "json") {
      const parsedJson = parseJsonCredentialField(rawValue, field.name);
      if (field.target === "credentials") credentials[field.name] = parsedJson;
      else if (field.target === "metadata") metadata[field.name] = parsedJson;
      else metadata[field.name] = parsedJson;
      continue;
    }

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

function normalizePlatformSecretMappings(metadata = {}) {
  const raw = Array.isArray(metadata.platform_secret_mappings) ? metadata.platform_secret_mappings : [];
  return raw
    .map((mapping = {}) => ({
      credential_field: normalizeFieldName(mapping.credential_field || mapping.field),
      secret_key: normalizeFieldName(mapping.secret_key || mapping.secretKey),
      secret_type: normalizeFieldName(mapping.secret_type || mapping.secretType || mapping.credential_role || mapping.credentialRole),
    }))
    .filter((mapping) => mapping.credential_field && mapping.secret_key)
    .slice(0, 20);
}

async function writeCredentialIntakeContinuationTask({ session, connectionId, metadata = {}, autoPromotion = null, req }) {
  const continuation = metadata.continuation && typeof metadata.continuation === "object" ? metadata.continuation : {};
  const taskKey = `credential_intake_completed:${session.session_id}`;
  const autoPromotionOk = autoPromotion?.ok === true;
  const targetKey = String(metadata.target_key || continuation.target_key || "").trim() || null;
  const providerFamily = String(metadata.provider_family || continuation.provider_family || "").trim() || null;
  const connectorFamily = String(metadata.connector_family || continuation.connector_family || "").trim() || null;
  const nextAction = continuation.next_action || (autoPromotionOk
    ? "Run provider/runtime readback and smoke validation without asking the user to type completion text."
    : "Read credential_intake completion status and continue the blocked workflow if promotion is complete.");
  const context = {
    event_type: "credential_intake.completed",
    session_id: session.session_id,
    connection_id: connectionId,
    tenant_id: session.tenant_id,
    user_id: session.user_id,
    app_key: session.app_key,
    auth_type: session.auth_type,
    target_key: targetKey,
    provider_family: providerFamily,
    connector_family: connectorFamily,
    auto_promotion_ok: autoPromotionOk,
    auto_promotion_status: autoPromotion?.ok ? "completed" : autoPromotion?.skipped ? "skipped" : "not_requested",
    promoted_count: autoPromotion?.promoted_count || 0,
    secret_keys: Array.isArray(autoPromotion?.promoted) ? autoPromotion.promoted.map((item) => item.secret_key).filter(Boolean) : [],
    continuation,
    no_user_done_message_required: true,
    secrets_included: false,
  };

  const title = continuation.title || `Credential intake completed for ${session.app_key}`;
  await getPool().query(
    `INSERT INTO platform_pending_tasks
       (task_id, task_key, title, description, brief, activation_prompt, task_type, priority, status,
        blocker_level, owner_scope, tenant_id, user_id, source_surface, source_ref,
        activation_visibility, context_json, created_by, updated_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, 'automation', ?, 'pending', 'soft', 'platform', ?, ?,
             'credential_intake.completed', ?, 1, ?, 'credential_intake_routes', 'credential_intake_routes')
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       description = VALUES(description),
       brief = VALUES(brief),
       activation_prompt = VALUES(activation_prompt),
       priority = VALUES(priority),
       status = IF(status = 'done', status, 'pending'),
       context_json = VALUES(context_json),
       updated_by = 'credential_intake_routes',
       updated_at = NOW()`,
    [
      taskKey,
      title,
      `A secure credential intake session was submitted for ${session.app_key}. Continue from the recorded event; do not ask the user to send a manual completion message.`,
      `Credential intake ${session.session_id} completed for ${session.app_key}; connection ${connectionId}; auto-promotion ${context.auto_promotion_status}.`,
      nextAction,
      continuation.priority || (autoPromotionOk ? "high" : "medium"),
      session.tenant_id,
      session.user_id,
      `credential_intake_sessions:${session.session_id}`,
      JSON.stringify(context),
    ]
  );

  writeAuditLogAsync({
    tenant_id: session.tenant_id,
    actor_id: session.user_id,
    actor_type: "credential_intake_link",
    action: "credential_intake.continuation_task_created",
    resource_type: "platform_pending_task",
    resource_id: taskKey,
    after_json: context,
    ip_address: req?.ip || null,
    user_agent: req?.headers?.["user-agent"] || null,
  });

  return { ok: true, task_key: taskKey, secrets_included: false };
}

async function maybeAutoPromotePlatformSecrets({ session, credentials = {}, metadata = {}, connectionId, req }) {
  if (metadata.auto_promote_platform_secrets !== true) return null;
  const promotionReason = String(metadata.promotion_reason || "").trim();
  if (metadata.promotion_approved !== true || promotionReason.length < 12) {
    return { ok: false, skipped: true, reason: "promotion_approval_required", secrets_included: false };
  }
  const mappings = normalizePlatformSecretMappings(metadata);
  if (!mappings.length) {
    return { ok: false, skipped: true, reason: "platform_secret_mappings_required", secrets_included: false };
  }

  const systemId = String(metadata.system_id || "").trim() || null;
  const ownerId = String(metadata.owner_id || "growth_intelligence_platform").trim();
  const providerFamily = String(metadata.provider_family || "").trim() || null;
  const connectorFamily = String(metadata.connector_family || "").trim() || null;
  const targetKey = String(metadata.target_key || "").trim() || null;
  const missingFields = mappings
    .filter((mapping) => !String(credentials[mapping.credential_field] || "").trim())
    .map((mapping) => mapping.credential_field);
  if (missingFields.length) {
    return { ok: false, skipped: true, reason: "mapped_intake_fields_missing", missing_fields: [...new Set(missingFields)], secrets_included: false };
  }

  const pool = getPool();
  const promoted = [];
  for (const mapping of mappings) {
    const value = String(credentials[mapping.credential_field] || "").trim();
    const secretType = mapping.secret_type || mapping.credential_field;
    const hash = sha256(value);
    const metadataJson = JSON.stringify({
      provisioning_status: "stored",
      stored_at: new Date().toISOString(),
      provider_family: providerFamily,
      connector_family: connectorFamily,
      credential_type: secretType,
      source: "credential_intake_auto_platform_secret_promotion",
      connection_id: connectionId,
      target_key: targetKey,
      promotion_reason: promotionReason,
    });

    await pool.query(
      `INSERT INTO platform_secrets
         (secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
       VALUES (?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
         secret_type = VALUES(secret_type),
         storage_backend = 'db_encrypted',
         secret_ref = NULL,
         value_sha256 = VALUES(value_sha256),
         value_ciphertext = VALUES(value_ciphertext),
         metadata_json = VALUES(metadata_json),
         status = 'active',
         updated_at = CURRENT_TIMESTAMP`,
      [mapping.secret_key, secretType, hash, encryptToken(value), metadataJson, metadata.created_by || "credential_intake_auto_platform_secret_promotion"]
    );

    const params = [ownerId, systemId, providerFamily, connectorFamily, secretType, mapping.secret_key];
    await pool.query(
      `UPDATE secret_references
          SET owner_type = 'platform',
              owner_id = ?,
              system_id = COALESCE(?, system_id),
              provider_family = COALESCE(?, provider_family),
              connector_family = COALESCE(?, connector_family),
              credential_type = ?,
              store_type = 'db_encrypted',
              env_var_name = NULL,
              vault_path = NULL,
              validation_status = 'stored',
              status = 'active'
        WHERE secret_key = ?
          AND owner_type = 'platform'`,
      params
    );
    promoted.push({ secret_key: mapping.secret_key, credential_field: mapping.credential_field, value_sha256: hash });
  }

  await pool.query(
    `UPDATE user_app_connections
        SET validation_status = 'promoted_to_platform_secrets', last_used_at = NOW()
      WHERE connection_id = ?`,
    [connectionId]
  ).catch(() => {});

  writeAuditLogAsync({
    tenant_id: session.tenant_id,
    actor_id: session.user_id,
    actor_type: "credential_intake_link",
    action: "credential_intake.platform_secrets_auto_promoted",
    resource_type: "user_app_connection",
    resource_id: connectionId,
    after_json: {
      system_id: systemId,
      owner_id: ownerId,
      target_key: targetKey,
      auth_type: session.auth_type,
      promoted_count: promoted.length,
      secret_keys: promoted.map((item) => item.secret_key),
      secrets_included: false,
    },
    ip_address: req?.ip || null,
    user_agent: req?.headers?.["user-agent"] || null,
  });

  return { ok: true, promoted_count: promoted.length, promoted, secrets_included: false };
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
    .json-file { background: #f8fafc; margin-top: 7px; }
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
  <script>
    document.querySelectorAll('.json-file').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 64 * 1024) { alert('JSON file is too large. Maximum size is 64KB.'); input.value = ''; return; }
        const target = document.querySelector('textarea[name="' + input.dataset.target + '"]');
        if (!target) return;
        target.value = await file.text();
      });
    });
  </script>
</body>
</html>`;
}

function renderDone(connectionId, autoPromotion = null) {
  const continuationHtml = autoPromotion?.continuationTask?.ok
    ? `<p>Continuation signal recorded. You do not need to send a manual “done” message.</p>`
    : "";
  const promotionHtml = autoPromotion?.ok
    ? `<p>Platform continuation completed automatically. Promoted fields: <code>${htmlEscape(autoPromotion.promoted_count || 0)}</code>.</p>${continuationHtml}`
    : autoPromotion?.skipped
      ? `<p>Connection saved. Automatic continuation is pending: <code>${htmlEscape(autoPromotion.reason || "skipped")}</code>.</p>${continuationHtml}`
      : continuationHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connection saved</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a}main{background:white;padding:28px;border-radius:24px;max-width:560px}code{background:#f1f5f9;padding:3px 6px;border-radius:8px}</style></head><body><main><h1>Connection saved</h1><p>The credential was encrypted and stored successfully.</p>${promotionHtml}<p>Connection ID: <code>${htmlEscape(connectionId)}</code></p><p>You can close this page.</p></main></body></html>`;
}

function absoluteBaseUrl(req) {
  const proto = req?.headers?.["x-forwarded-proto"] || req?.protocol || "https";
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  return host ? `${proto}://${host}` : "";
}

export async function createCredentialIntakeSessionRecord({
  pool = getPool(),
  request = null,
  userId,
  tenantId,
  appKey,
  authType,
  displayLabel = null,
  mcpEndpoint = null,
  webhookUrl = null,
  apiBaseUrl = null,
  workspaceId = null,
  connectionTargetRef = null,
  purpose = null,
  redirectUri = null,
  authoritySnapshot = null,
  credentialSchema = null,
  metadata = {},
  expiresInMinutes = DEFAULT_TTL_MINUTES,
  createdBy = null,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedAppKey = String(appKey || "").trim();
  const normalizedAuthType = String(authType || "").trim();
  if (!normalizedUserId || !normalizedTenantId || !normalizedAppKey || !normalizedAuthType) {
    const err = new Error("user_id, tenant_id, app_key, auth_type are required.");
    err.status = 400;
    err.code = "missing_required_fields";
    throw err;
  }
  if (!ALLOWED_AUTH_TYPES.has(normalizedAuthType)) {
    const err = new Error("Unsupported auth_type.");
    err.status = 400;
    err.code = "unsupported_auth_type";
    throw err;
  }

  const app = await loadApp(normalizedAppKey, pool);
  if (!app) {
    const err = new Error(`App ${normalizedAppKey} was not found.`);
    err.status = 404;
    err.code = "app_not_found";
    throw err;
  }
  if (!["active", "beta"].includes(String(app.status || "").toLowerCase())) {
    const err = new Error("App is not active or beta.");
    err.status = 409;
    err.code = "app_not_active";
    throw err;
  }

  const normalizedSchema = normalizeCredentialSchema(normalizedAuthType, credentialSchema || null);
  if (normalizedAuthType !== "oauth2" && !normalizedSchema.length) {
    const err = new Error("No credential fields are available for this auth_type.");
    err.status = 400;
    err.code = "empty_credential_schema";
    throw err;
  }

  const sessionId = randomUUID();
  const token = randomToken();
  const tokenHash = sha256(token);
  const ttl = clampTtlMinutes(expiresInMinutes);
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const safeMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const normalizedTargetRef = String(
    connectionTargetRef
      || safeMetadata.connection_target_ref
      || (workspaceId ? `workspace:${workspaceId}:app:${normalizedAppKey}` : `app:${normalizedAppKey}`)
  ).trim().slice(0, 255);
  const normalizedPurpose = String(purpose || safeMetadata.purpose || `connect:${normalizedAppKey}`).trim().slice(0, 160);
  const allowedRedirectUri = normalizeCredentialIntakeRedirect({
    redirectUri,
    requestOrigin: absoluteBaseUrl(request),
    registryAllowlist: app.credential_intake_redirect_allowlist_json,
  });
  const authoritySnapshotHash = String(authoritySnapshot?.snapshot_hash || "").trim() || null;
  const authoritySnapshotVersion = String(authoritySnapshot?.version || "").trim().slice(0, 64) || null;
  const binding = buildCredentialIntakeBinding({
    userId: normalizedUserId,
    tenantId: normalizedTenantId,
    appKey: normalizedAppKey,
    authType: normalizedAuthType,
    connectionTargetRef: normalizedTargetRef,
    purpose: normalizedPurpose,
    allowedRedirectUri,
    authoritySnapshotHash,
  });

  await pool.query(
    `INSERT INTO credential_intake_sessions
       (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
        mcp_endpoint, webhook_url, api_base_url, workspace_id, credential_schema_json,
        metadata_json, status, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    [sessionId, tokenHash, normalizedUserId, normalizedTenantId, normalizedAppKey, normalizedAuthType, displayLabel || null,
     mcpEndpoint || null, webhookUrl || null, apiBaseUrl || null, workspaceId || null,
     JSON.stringify({ fields: normalizedSchema }), JSON.stringify(safeMetadata), expiresAt, createdBy || normalizedUserId]
  );

  const path = `/credential-intake/${encodeURIComponent(token)}`;
  const baseUrl = absoluteBaseUrl(request);
  return {
    ok: true,
    session_id: sessionId,
    intake_url: baseUrl ? `${baseUrl}${path}` : path,
    expires_at: expiresAt,
    app_key: normalizedAppKey,
    auth_type: normalizedAuthType,
    field_count: normalizedSchema.length,
    secrets_included: false,
  };
}

export function buildCredentialIntakeRoutes(deps = {}) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // Browser form submissions are application/x-www-form-urlencoded. Keep this
  // local to credential-intake so JSON admin/API routes are unaffected.
  router.use("/credential-intake", urlencoded({ extended: false, limit: "64kb" }));

  router.post("/credential-intake/sessions", requireBackendApiKey, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createCredentialIntakeSessionRecord({
        request: req,
        userId: input.user_id,
        tenantId: input.tenant_id,
        appKey: input.app_key,
        authType: input.auth_type,
        displayLabel: input.display_label || null,
        mcpEndpoint: input.mcp_endpoint || null,
        webhookUrl: input.webhook_url || null,
        apiBaseUrl: input.api_base_url || null,
        workspaceId: input.workspace_id || null,
        credentialSchema: input.credential_schema || null,
        metadata: input.metadata || {},
        expiresInMinutes: input.expires_in_minutes,
        createdBy: input.created_by || req?.auth?.user_id || null,
      });
      return res.status(201).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "credential_intake_session_create_failed", message: err.message },
        secrets_included: false,
      });
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
      const consumed = await atomicallyConsumeCredentialIntakeSession({
        pool: getPool(),
        tokenHash: sha256(req.params.token),
        createConnection: async ({ connection: transaction, session }) => {
          const schema = sessionSchema(session);
          const {
            credentials,
            metadata,
            connection: submittedConnection,
            displayLabel,
          } = collectSubmission({ authType: session.auth_type, schema, body: req.body || {}, session });
          const connectionId = randomUUID();
          await transaction.query(
            `INSERT INTO user_app_connections
               (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
                encrypted_credentials, account_label, account_metadata,
                mcp_endpoint, webhook_url, api_base_url, is_primary, status, validation_status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active','pending_validation')`,
            [connectionId, session.user_id, session.tenant_id, session.app_key, displayLabel,
             session.auth_type, encryptCredentials(credentials), displayLabel || submittedConnection.api_base_url || submittedConnection.mcp_endpoint || submittedConnection.webhook_url || null,
             JSON.stringify({ ...metadata, intake_session_id: session.session_id, intake_type: "schema_driven_web_form" }),
             submittedConnection.mcp_endpoint, submittedConnection.webhook_url, submittedConnection.api_base_url]
          );
          return { connectionId, schema, credentials, metadata, submittedConnection };
        },
      });
      if (!consumed.ok) return res.status(consumed.status).type("text").send(consumed.error);

      const { session, connectionId } = consumed;
      const { schema, credentials, metadata, submittedConnection } = consumed.created;

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
          has_mcp_endpoint: !!submittedConnection.mcp_endpoint,
          has_webhook_url: !!submittedConnection.webhook_url,
          has_api_base_url: !!submittedConnection.api_base_url,
        },
        ip_address: req.ip,
        user_agent: req.headers["user-agent"] || null,
      });

      const autoPromotion = await maybeAutoPromotePlatformSecrets({ session, credentials, metadata, connectionId, req });
      const continuationTask = await writeCredentialIntakeContinuationTask({ session, connectionId, metadata, autoPromotion, req })
        .catch((error) => ({ ok: false, error: error.message, secrets_included: false }));
      await enqueueCredentialIntakeCompletedWebhook({ pool: getPool(), session, connectionId }).catch((error) => {
        writeAuditLogAsync({
          tenant_id: session.tenant_id,
          actor_id: session.user_id,
          actor_type: "credential_intake_link",
          action: "credential_intake.webhook_enqueue_failed",
          resource_type: "credential_intake_session",
          resource_id: session.session_id,
          after_json: { error_code: error.code || "credential_intake_webhook_enqueue_failed", secrets_included: false },
          ip_address: req.ip,
          user_agent: req.headers["user-agent"] || null,
        });
      });

      return res.status(201).type("html").send(renderDone(connectionId, { ...autoPromotion, continuationTask }));
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
