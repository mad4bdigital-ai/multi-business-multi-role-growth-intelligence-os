import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { resolvePrivatePlatformPluginContribution } from "./platformPluginContribution.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const BLOCKED_HOST_PREFIXES = ["10.", "192.168.", "169.254.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."];

function compactString(value = "", max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKey(value = "") {
  return compactString(value, 256).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function parseStoredJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
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

function safeHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalized = String(key || "").toLowerCase();
    if (["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"].includes(normalized)) continue;
    out[String(key).slice(0, 80)] = String(value).slice(0, 500);
  }
  return out;
}

function isBlockedUrl(url) {
  if (url.protocol !== "https:") return "https_required";
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return "blocked_host";
  if (BLOCKED_HOST_PREFIXES.some((prefix) => host.startsWith(prefix))) return "private_network_blocked";
  if (host.endsWith(".local") || host.endsWith(".internal")) return "internal_host_blocked";
  return null;
}

function findAction(contribution, actionKey) {
  const actions = parseStoredJson(contribution.action_bindings_json, []);
  return actions.find((action) => String(action.action_key || "") === String(actionKey)) || null;
}

function buildUrl({ baseUrl, path }) {
  const base = new URL(baseUrl);
  return new URL(path || "/", base);
}

async function loadContribution(pool, contributionId) {
  const rows = await safeQuery(pool, `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`, [contributionId]);
  return rows[0] || null;
}

async function loadOwnerConnection(pool, { pluginKey, tenantId, userId, requestedCredentialScope }) {
  const rows = await safeQuery(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, status, validation_status,
            api_base_url, account_metadata, last_validated_at, last_used_at, is_primary
       FROM user_app_connections
      WHERE app_key = ?
        AND tenant_id = ?
        AND user_id = ?
        AND status = 'active'
        AND api_base_url IS NOT NULL
      ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC
      LIMIT 1`,
    [pluginKey, tenantId, userId]
  );
  const connection = rows[0] || null;
  if (!connection) return null;
  const metadata = parseStoredJson(connection.account_metadata, {});
  const allowedScopes = Array.isArray(metadata.allowed_scopes) ? metadata.allowed_scopes : [];
  if (allowedScopes.length && requestedCredentialScope && !allowedScopes.includes(requestedCredentialScope)) return null;
  return connection;
}

async function writeExecutionLog({ pool, traceId, status, payload }) {
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
      "platform_plugin_private_rest_dispatch",
      "platform_plugin_private_runtime",
      "platformPluginPrivateRestDispatch",
      payload?.plugin_key ? `private rest dispatch ${payload.plugin_key}` : "private rest dispatch",
      "platform_plugin_contribution_private_dispatch_rest",
      "platform_plugin_owner_scoped_rest_adapter",
      "owner_scoped_private_rest_dispatch",
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

export async function dispatchPrivatePlatformPluginRestAction({
  pool = getPool(),
  contributionId,
  actionKey,
  tenantId,
  userId,
  requestedCredentialScope = "tenant_connection",
  input = {},
  dryRun = false,
  timeoutMs = 10000,
} = {}) {
  const normalizedContributionId = compactString(contributionId, 64);
  const normalizedActionKey = compactString(actionKey, 191);
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64);
  if (!normalizedContributionId || !normalizedActionKey || !normalizedTenantId || !normalizedUserId) {
    const err = new Error("contribution_id, action_key, tenant_id, and user_id are required.");
    err.code = "missing_private_dispatch_context";
    err.status = 400;
    throw err;
  }

  const resolved = await resolvePrivatePlatformPluginContribution({
    pool,
    contributionId: normalizedContributionId,
    actionKey: normalizedActionKey,
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    requestedCredentialScope,
  });
  if (!resolved.allowed) {
    return { ok: true, dispatched: false, reason: resolved.reason, resolution: resolved, secrets_included: false };
  }

  const contribution = await loadContribution(pool, normalizedContributionId);
  const action = findAction(contribution, normalizedActionKey);
  const method = String(action?.method || action?.http_method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: true, dispatched: false, reason: "http_method_not_allowed", method, secrets_included: false };
  }
  const path = compactString(action?.path || action?.http_path || "/", 1000);
  const pluginKey = normalizeKey(contribution.plugin_key);
  const connection = await loadOwnerConnection(pool, {
    pluginKey,
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    requestedCredentialScope,
  });
  if (!connection) {
    return {
      ok: true,
      dispatched: false,
      reason: "active_owner_connection_with_api_base_url_required",
      plugin_key: pluginKey,
      required_connection: { app_key: pluginKey, tenant_id: normalizedTenantId, user_id: normalizedUserId, credential_scope: requestedCredentialScope },
      secrets_included: false,
    };
  }

  let url;
  try {
    url = buildUrl({ baseUrl: connection.api_base_url, path });
  } catch {
    return { ok: true, dispatched: false, reason: "invalid_connection_api_base_url_or_action_path", secrets_included: false };
  }
  const blocked = isBlockedUrl(url);
  if (blocked) return { ok: true, dispatched: false, reason: blocked, url: url.origin, secrets_included: false };

  const headers = safeHeaders(action?.headers || {});
  const bodyTemplate = action?.body_template && typeof action.body_template === "object" ? action.body_template : null;
  const hasBody = bodyTemplate && !["GET", "DELETE"].includes(method);
  const body = hasBody ? JSON.stringify({ ...bodyTemplate, input }) : undefined;
  if (hasBody) headers["content-type"] = headers["content-type"] || "application/json";

  const traceId = `platform_plugin_private_rest_${randomUUID()}`;
  const requestSummary = {
    contribution_id: normalizedContributionId,
    plugin_key: pluginKey,
    action_key: normalizedActionKey,
    tenant_id: normalizedTenantId,
    user_id: normalizedUserId,
    connection_id: connection.connection_id,
    method,
    url_origin: url.origin,
    url_path: url.pathname,
    dry_run: Boolean(dryRun),
  };

  if (dryRun) {
    const log = await writeExecutionLog({ pool, traceId, status: "success", payload: { ...requestSummary, result: "dry_run" } });
    return {
      ok: true,
      dispatched: false,
      reason: "dry_run",
      request: requestSummary,
      execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
      secrets_included: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(timeoutMs) || 10000, 30000)));
  let response;
  let responseText = "";
  try {
    response = await fetch(url, { method, headers, body, signal: controller.signal });
    responseText = await response.text();
  } catch (err) {
    clearTimeout(timer);
    const log = await writeExecutionLog({ pool, traceId, status: "failed", payload: { ...requestSummary, error: err.name || err.message } });
    return {
      ok: true,
      dispatched: false,
      reason: err.name === "AbortError" ? "request_timeout" : "request_failed",
      error: err.message,
      execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
      secrets_included: false,
    };
  } finally {
    clearTimeout(timer);
  }

  await pool.query(`UPDATE user_app_connections SET last_used_at = CURRENT_TIMESTAMP WHERE connection_id = ?`, [connection.connection_id]);
  const success = response.status >= 200 && response.status < 400;
  const log = await writeExecutionLog({
    pool,
    traceId,
    status: success ? "success" : "failed",
    payload: {
      ...requestSummary,
      response_status: response.status,
      response_ok: success,
      response_preview: responseText.slice(0, 2000),
    },
  });

  return {
    ok: true,
    dispatched: true,
    success,
    response: {
      status: response.status,
      ok: response.ok,
      content_type: response.headers.get("content-type") || null,
      body_preview: responseText.slice(0, 4000),
    },
    request: requestSummary,
    execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
