import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";
import { resolvePlatformPluginExecution } from "./platformPluginResolver.js";
import { resolveExecutionReadinessDryRun } from "./executionReadinessDryRun.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const BLOCKED_HOST_PREFIXES = ["10.", "192.168.", "169.254.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."];

function compactString(value = "", max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKey(value = "", max = 255) {
  return compactString(value, max).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
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

function buildUrl({ baseUrl, path }) {
  const base = new URL(baseUrl);
  return new URL(path || "/", base);
}

function extractActionTemplate(action) {
  if (!action || typeof action !== "object") return null;
  const method = String(action.method || action.http_method || action.verb || "").toUpperCase();
  const path = compactString(action.path || action.http_path || action.endpoint_path || "", 1000);
  if (!method || !path) return null;
  return {
    method,
    path,
    headers: action.headers && typeof action.headers === "object" ? action.headers : {},
    body_template: action.body_template && typeof action.body_template === "object" ? action.body_template : null,
  };
}

async function loadPromotedContributionActionTemplate(pool, { pluginKey, actionKey }) {
  const rows = await safeQuery(
    pool,
    `SELECT contribution_id, plugin_key, status, certification_status, action_bindings_json
       FROM platform_plugin_contributions
      WHERE plugin_key = ?
        AND status IN ('certified','promoted','active')
      ORDER BY promoted_at DESC, certified_at DESC, updated_at DESC
      LIMIT 5`,
    [pluginKey]
  );
  for (const row of rows) {
    const actions = parseStoredJson(row.action_bindings_json, []);
    const action = Array.isArray(actions)
      ? actions.find((item) => String(item?.action_key || "") === String(actionKey))
      : null;
    const template = extractActionTemplate(action);
    if (template) return { template, source: "platform_plugin_contributions.action_bindings_json", contribution: row };
  }
  return { template: null, source: null, contribution: rows[0] || null };
}

async function loadConnection(pool, connectionId) {
  const rows = await safeQuery(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, status, validation_status,
            api_base_url, account_metadata, last_validated_at, last_used_at, is_primary
       FROM user_app_connections
      WHERE connection_id = ?
        AND status = 'active'
      LIMIT 1`,
    [connectionId]
  );
  return rows[0] || null;
}

async function writeExecutionLog({ pool, traceId, status, payload }) {
  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "platform_plugin_rest_dispatch",
    executionClass: "platform_plugin_runtime",
    sourceLayer: "platformPluginRestDispatch",
    userInput: payload?.plugin_key ? `platform plugin rest dispatch ${payload.plugin_key}` : "platform plugin rest dispatch",
    routeKeys: "platform_plugin_dispatch_rest",
    selectedWorkflows: "platform_plugin_rest_adapter",
    executionMode: "platform_plugin_rest_dispatch",
    decisionTrigger: "admin_tool",
    executionStatus: status,
    outputSummary: { ...payload, secrets_included: false },
    recoveryStatus: "not_required",
    routeStatus: "resolved",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: status === "success" ? "ready" : "degraded",
    logSource: "sql_primary",
  });
  return evidence.row || null;
}

export async function dispatchPlatformPluginRestAction({
  pool = getPool(),
  pluginKey,
  actionKey,
  tenantId,
  userId,
  agentId = null,
  requestedCredentialScope = "tenant_connection",
  input = {},
  dryRun = false,
  timeoutMs = 10000,
  enforceExecutionReadiness = true,
  brandKey = null,
  businessTypeKey = null,
  businessActivityTypeKey = null,
  workflowKey = null,
  logicKey = null,
  logicPackKey = null,
  skillKey = null,
  actorRole = null,
  governanceLevel = null,
  graphDepth = 1,
  graphLimit = 120,
  detailLimit = 10,
  edgeDetailLimit = 10,
} = {}) {
  const normalizedPluginKey = normalizeKey(pluginKey, 128);
  const normalizedActionKey = normalizeKey(actionKey, 128);
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64);
  const normalizedAgentId = compactString(agentId, 64) || null;
  if (!normalizedPluginKey || !normalizedActionKey || !normalizedTenantId || !normalizedUserId) {
    const err = new Error("plugin_key, action_key, tenant_id, and user_id are required.");
    err.code = "missing_platform_dispatch_context";
    err.status = 400;
    throw err;
  }

  let executionReadiness = null;
  if (enforceExecutionReadiness !== false) {
    executionReadiness = await resolveExecutionReadinessDryRun({
      action_key: normalizedActionKey,
      endpoint_key: normalizedActionKey,
      plugin_key: normalizedPluginKey,
      tenant_id: normalizedTenantId,
      user_id: normalizedUserId,
      agent_id: normalizedAgentId,
      brand_key: brandKey || input?.brand_key || input?.target_key || null,
      business_type_key: businessTypeKey || input?.business_type_key || null,
      business_activity_type_key: businessActivityTypeKey || input?.business_activity_type_key || input?.activity_key || null,
      workflow_key: workflowKey || input?.workflow_key || null,
      logic_key: logicKey || input?.logic_key || null,
      logic_pack_key: logicPackKey || input?.logic_pack_key || null,
      skill_key: skillKey || input?.skill_key || null,
      actor_role: actorRole || input?.actor_role || null,
      governance_level: governanceLevel || input?.governance_level || null,
      preview_enforce: true,
      require_plugin_connection: true,
      graph_depth: graphDepth,
      graph_limit: graphLimit,
      detail_limit: detailLimit,
      edge_detail_limit: edgeDetailLimit,
    });
    if (executionReadiness.dispatch_ready !== true) {
      return {
        ok: true,
        dispatched: false,
        reason: "execution_readiness_not_dispatch_ready",
        execution_readiness: executionReadiness,
        secrets_included: false,
      };
    }
  }

  const resolution = await resolvePlatformPluginExecution({
    pool,
    pluginKey: normalizedPluginKey,
    actionKey: normalizedActionKey,
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    agentId: normalizedAgentId,
    requestedCredentialScope,
  });
  if (!resolution.allowed || resolution.mode !== "dispatch_ready" || resolution.execution?.will_execute !== true) {
    return {
      ok: true,
      dispatched: false,
      reason: "platform_plugin_not_dispatch_ready",
      resolution,
      secrets_included: false,
    };
  }

  const connectionId = resolution.credential_resolution?.connection_id;
  const connection = connectionId ? await loadConnection(pool, connectionId) : null;
  if (!connection || !connection.api_base_url) {
    return {
      ok: true,
      dispatched: false,
      reason: "active_connection_with_api_base_url_required",
      plugin_key: normalizedPluginKey,
      action_key: normalizedActionKey,
      connection_id: connectionId || null,
      secrets_included: false,
    };
  }

  const { template, source, contribution } = await loadPromotedContributionActionTemplate(pool, {
    pluginKey: normalizedPluginKey,
    actionKey: normalizedActionKey,
  });
  if (!template) {
    return {
      ok: true,
      dispatched: false,
      reason: "dispatch_template_missing",
      plugin_key: normalizedPluginKey,
      action_key: normalizedActionKey,
      template_sources_checked: ["platform_plugin_contributions.action_bindings_json"],
      contribution_id: contribution?.contribution_id || null,
      secrets_included: false,
    };
  }
  if (!ALLOWED_METHODS.has(template.method)) {
    return { ok: true, dispatched: false, reason: "http_method_not_allowed", method: template.method, secrets_included: false };
  }

  let url;
  try {
    url = buildUrl({ baseUrl: connection.api_base_url, path: template.path });
  } catch {
    return { ok: true, dispatched: false, reason: "invalid_connection_api_base_url_or_action_path", secrets_included: false };
  }
  const blocked = isBlockedUrl(url);
  if (blocked) return { ok: true, dispatched: false, reason: blocked, url: url.origin, secrets_included: false };

  const headers = safeHeaders(template.headers || {});
  const hasBody = template.body_template && !["GET", "DELETE"].includes(template.method);
  const body = hasBody ? JSON.stringify({ ...template.body_template, input }) : undefined;
  if (hasBody) headers["content-type"] = headers["content-type"] || "application/json";

  const traceId = `platform_plugin_rest_${randomUUID()}`;
  const requestSummary = {
    plugin_key: normalizedPluginKey,
    action_key: normalizedActionKey,
    tenant_id: normalizedTenantId,
    user_id: normalizedUserId,
    agent_id: normalizedAgentId,
    connection_id: connection.connection_id,
    contribution_id: contribution?.contribution_id || null,
    template_source: source,
    method: template.method,
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
      resolution,
      execution_readiness: executionReadiness,
      execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
      secrets_included: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(timeoutMs) || 10000, 30000)));
  let response;
  let responseText = "";
  try {
    response = await fetch(url, { method: template.method, headers, body, signal: controller.signal });
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
    resolution,
    execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
