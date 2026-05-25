import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { upsertPlatformPluginPolicy } from "./platformPluginPolicy.js";

const VALID_SOURCE_MODES = new Set(["managed", "dedicated"]);
const VALID_CONNECTION_SCOPES = new Set(["tenant_connection", "user_connection"]);
const SECRET_KEY_HINTS = [
  "password", "passwd", "secret", "token", "private_key", "api_key",
  "apikey", "auth_key", "access_token", "refresh_token", "client_secret",
  "encrypted_credentials", "credential_ref",
];
const SAFE_METADATA_KEYS = new Set([
  "api_base_url", "mcp_endpoint", "webhook_url", "account_label", "account_metadata",
  "allowed_scopes", "supported_scopes", "scope", "scopes", "credential_scope",
  "connection_scope", "fallback_allowed", "display_label", "description", "smoke_test",
  "secrets_included", "tenant_connection", "user_connection",
]);

function compactString(value = "", max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKey(value = "") {
  return compactString(value, 256).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function normalizeSourceMode(value = "dedicated") {
  const normalized = normalizeKey(value);
  if (["managed", "platform", "platform_managed"].includes(normalized)) return "managed";
  if (["dedicated", "tenant", "tenant_owned", "customer_owned"].includes(normalized)) return "dedicated";
  return normalized;
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function payloadContainsSecret(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, nested] of Object.entries(current)) {
      const lowerKey = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (!SAFE_METADATA_KEYS.has(lowerKey) && SECRET_KEY_HINTS.some((hint) => lowerKey.includes(hint))) return true;
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
  return false;
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

function isoNow() { return new Date().toISOString(); }
function sqlDate(iso) { return String(iso || isoNow()).slice(0, 10); }

function validateHttpsUrl(value, fieldName) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch {
    const err = new Error(`${fieldName} must be a valid URL.`);
    err.code = `invalid_${fieldName}`;
    err.status = 400;
    throw err;
  }
  if (url.protocol !== "https:") {
    const err = new Error(`${fieldName} must use HTTPS.`);
    err.code = `${fieldName}_https_required`;
    err.status = 400;
    throw err;
  }
  return String(url).slice(0, 512);
}

async function writeInstallExecutionLog({ pool, traceId, status, payload }) {
  const now = isoNow();
  await pool.query(
    `INSERT INTO execution_log
       (run_date, start_time, end_time, entry_type, execution_class, source_layer,
        user_input, route_keys, selected_workflows, execution_mode, decision_trigger,
        execution_status, output_summary, recovery_status, route_status, route_source,
        intake_validation_status, execution_ready_status, execution_trace_id_writeback,
        log_source_writeback, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [
      sqlDate(now), now, now,
      "platform_plugin_tenant_install",
      "platform_plugin_install",
      "platformPluginInstall",
      payload?.plugin_key ? `install platform plugin ${payload.plugin_key}` : "install platform plugin",
      "platform_plugin_tenant_install",
      "platform_plugin_install_policy_connection",
      "tenant_plugin_install",
      "admin_tool",
      status,
      JSON.stringify({ ...payload, secrets_included: false }),
      "not_required",
      "resolved",
      "sql_primary",
      "validated",
      status === "success" ? "ready" : "degraded",
      traceId,
      "sql_primary",
    ]
  );
  const rows = await safeQuery(pool, `SELECT id, execution_status, execution_trace_id_writeback FROM execution_log WHERE execution_trace_id_writeback = ? ORDER BY id DESC LIMIT 1`, [traceId]);
  return rows[0] || null;
}

async function ensureNoSecretConnection({
  pool,
  plugin,
  tenantId,
  userId,
  connectionScope,
  apiBaseUrl = null,
  mcpEndpoint = null,
  webhookUrl = null,
  accountLabel = null,
  accountMetadata = {},
  displayLabel = null,
} = {}) {
  if (!userId) return null;
  const normalizedScope = normalizeKey(connectionScope || "tenant_connection");
  if (!VALID_CONNECTION_SCOPES.has(normalizedScope)) {
    const err = new Error("connection_scope must be tenant_connection or user_connection.");
    err.code = "invalid_connection_scope";
    err.status = 400;
    throw err;
  }
  const metadata = {
    ...(accountMetadata && typeof accountMetadata === "object" && !Array.isArray(accountMetadata) ? accountMetadata : {}),
    allowed_scopes: [normalizedScope],
    connection_scope: normalizedScope,
    installed_from_platform_base: true,
    secrets_included: false,
  };
  const urls = {
    api_base_url: validateHttpsUrl(apiBaseUrl, "api_base_url"),
    mcp_endpoint: validateHttpsUrl(mcpEndpoint, "mcp_endpoint"),
    webhook_url: validateHttpsUrl(webhookUrl, "webhook_url"),
  };

  const existing = await safeQuery(
    pool,
    `SELECT connection_id FROM user_app_connections
      WHERE tenant_id = ? AND user_id = ? AND app_key = ? AND status = 'active'
      ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC
      LIMIT 1`,
    [tenantId, userId, plugin.app_key]
  );
  const existingId = existing[0]?.connection_id || null;
  if (existingId) {
    await pool.query(
      `UPDATE user_app_connections
          SET display_label = COALESCE(?, display_label),
              account_label = COALESCE(?, account_label),
              account_metadata = ?,
              api_base_url = COALESCE(?, api_base_url),
              mcp_endpoint = COALESCE(?, mcp_endpoint),
              webhook_url = COALESCE(?, webhook_url),
              validation_status = 'metadata_only',
              last_validated_at = CURRENT_TIMESTAMP,
              status = 'active'
        WHERE connection_id = ?`,
      [compactString(displayLabel, 128) || null, compactString(accountLabel, 255) || null, JSON.stringify(metadata), urls.api_base_url, urls.mcp_endpoint, urls.webhook_url, existingId]
    );
    return { connection_id: existingId, created: false, updated: true, validation_status: "metadata_only" };
  }

  const connectionId = randomUUID();
  await pool.query(
    `INSERT INTO user_app_connections
       (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
        encrypted_credentials, credential_ref, scopes_granted, account_label,
        account_metadata, mcp_endpoint, webhook_url, api_base_url, is_primary,
        status, validation_status, connected_at, last_validated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,1,'active','metadata_only',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [
      connectionId,
      userId,
      tenantId,
      plugin.app_key,
      compactString(displayLabel || `${plugin.display_name} connection`, 128),
      plugin.auth_type,
      normalizedScope,
      compactString(accountLabel || plugin.display_name, 255),
      JSON.stringify(metadata),
      urls.mcp_endpoint,
      urls.webhook_url,
      urls.api_base_url,
    ]
  );
  return { connection_id: connectionId, created: true, updated: false, validation_status: "metadata_only" };
}

export async function installPlatformPluginForTenant({
  pool = getPool(),
  tenantId,
  userId = null,
  pluginKey,
  sourceMode = "dedicated",
  fallbackAllowed = false,
  requiredForDeviceInstall = false,
  notes = "",
  connection = null,
  rawPayload = null,
} = {}) {
  if (rawPayload && payloadContainsSecret(rawPayload)) {
    const err = new Error("Secrets are not accepted by Platform Plugin install. Use credential intake/OAuth after install.");
    err.code = "secrets_not_allowed";
    err.status = 400;
    throw err;
  }

  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = userId ? compactString(userId, 64) : null;
  const normalizedPluginKey = normalizeKey(pluginKey);
  const normalizedMode = normalizeSourceMode(sourceMode);
  if (!normalizedTenantId || !normalizedPluginKey) {
    const err = new Error("tenant_id and plugin_key are required.");
    err.code = "missing_install_context";
    err.status = 400;
    throw err;
  }
  if (!VALID_SOURCE_MODES.has(normalizedMode)) {
    const err = new Error("source_mode must be managed or dedicated.");
    err.code = "invalid_source_mode";
    err.status = 400;
    throw err;
  }

  const pluginRows = await safeQuery(pool, `SELECT app_key, display_name, auth_type, status FROM app_integrations WHERE app_key = ? LIMIT 1`, [normalizedPluginKey]);
  const plugin = pluginRows[0] || null;
  if (!plugin || !["active", "beta"].includes(String(plugin.status || "").toLowerCase())) {
    const err = new Error("Installable Platform Base plugin not found.");
    err.code = "plugin_not_installable";
    err.status = 404;
    throw err;
  }

  const policy = await upsertPlatformPluginPolicy({
    pool,
    tenantId: normalizedTenantId,
    pluginKey: normalizedPluginKey,
    sourceMode: normalizedMode,
    fallbackAllowed: boolValue(fallbackAllowed, normalizedMode === "managed"),
    requiredForDeviceInstall: boolValue(requiredForDeviceInstall, false),
    notes: compactString(notes || `Installed ${normalizedPluginKey} from Platform Base`, 1000),
    userId: normalizedUserId,
    source: "platform_plugin_tenant_install",
    rawPayload: null,
  });

  const connectionResult = connection
    ? await ensureNoSecretConnection({
        pool,
        plugin,
        tenantId: normalizedTenantId,
        userId: normalizedUserId,
        connectionScope: connection.connection_scope || connection.connectionScope || "tenant_connection",
        apiBaseUrl: connection.api_base_url || connection.apiBaseUrl || null,
        mcpEndpoint: connection.mcp_endpoint || connection.mcpEndpoint || null,
        webhookUrl: connection.webhook_url || connection.webhookUrl || null,
        accountLabel: connection.account_label || connection.accountLabel || null,
        accountMetadata: connection.account_metadata || connection.accountMetadata || {},
        displayLabel: connection.display_label || connection.displayLabel || null,
      })
    : null;

  const traceId = `platform_plugin_install_${randomUUID()}`;
  const log = await writeInstallExecutionLog({
    pool,
    traceId,
    status: policy.ok ? "success" : "failed",
    payload: {
      tenant_id: normalizedTenantId,
      user_id: normalizedUserId,
      plugin_key: normalizedPluginKey,
      policy_ok: Boolean(policy.ok),
      connection_id: connectionResult?.connection_id || null,
      connection_metadata_only: Boolean(connectionResult),
      platform_base_status: plugin.status,
    },
  });

  return {
    ok: Boolean(policy.ok),
    plugin: {
      plugin_key: plugin.app_key,
      display_name: plugin.display_name,
      auth_type: plugin.auth_type,
      status: plugin.status,
    },
    install: {
      tenant_policy: policy.policy,
      connection: connectionResult,
      credential_next_step: connectionResult ? "credential_metadata_registered_no_secret" : "credential_intake_or_oauth_required_if_action_needs_connection",
    },
    execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
