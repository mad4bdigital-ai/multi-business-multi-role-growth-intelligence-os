import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_HEADER_KEYS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]);
const SECRET_KEY_HINTS = [
  "password", "passwd", "secret", "token", "credential", "private_key", "api_key",
  "apikey", "auth_key", "access_token", "refresh_token", "client_secret",
];
const TEMPLATE_STATUSES = new Set(["draft", "submitted", "validation_failed", "certified", "promoted", "active"]);

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

function payloadContainsSecret(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, nested] of Object.entries(current)) {
      const lowerKey = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (SECRET_KEY_HINTS.some((hint) => lowerKey.includes(hint))) return true;
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
  return false;
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = String(key || "").toLowerCase();
    if (BLOCKED_HEADER_KEYS.has(normalized)) {
      const err = new Error(`Header ${key} is not allowed in Platform Plugin action templates.`);
      err.code = "blocked_template_header";
      err.status = 400;
      throw err;
    }
    out[String(key).slice(0, 80)] = String(value).slice(0, 500);
  }
  return out;
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

async function writeTemplateExecutionLog({ pool, traceId, status, payload }) {
  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "platform_plugin_action_template_upsert",
    executionClass: "platform_plugin_template_management",
    sourceLayer: "platformPluginActionTemplate",
    userInput: payload?.plugin_key ? `platform plugin action template ${payload.plugin_key}:${payload.action_key}` : "platform plugin action template",
    routeKeys: "platform_plugin_action_template_upsert",
    selectedWorkflows: "platform_plugin_protocol_template_management",
    executionMode: "registry_template_mutation",
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

function safeAction(action = {}) {
  return {
    action_key: action.action_key || null,
    risk_level: action.risk_level || null,
    method: action.method || action.http_method || null,
    path: action.path || action.http_path || null,
    headers: action.headers && typeof action.headers === "object" ? Object.keys(action.headers) : [],
    has_body_template: Boolean(action.body_template && typeof action.body_template === "object"),
  };
}

export async function upsertPlatformPluginActionTemplate({
  pool = getPool(),
  contributionId = null,
  pluginKey = null,
  actionKey,
  method,
  path,
  headers = {},
  bodyTemplate = null,
  tenantId = null,
  userId = null,
  updatedBy = null,
  rawPayload = null,
} = {}) {
  if (rawPayload && payloadContainsSecret(rawPayload)) {
    const err = new Error("Secrets are not accepted in Platform Plugin action templates. Store credentials through credential intake/connections only.");
    err.code = "secrets_not_allowed";
    err.status = 400;
    throw err;
  }

  const normalizedContributionId = compactString(contributionId, 64) || null;
  const normalizedPluginKey = pluginKey ? normalizeKey(pluginKey, 128) : null;
  const normalizedActionKey = normalizeKey(actionKey, 128);
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const normalizedPath = compactString(path, 1000);
  const normalizedHeaders = normalizeHeaders(headers || {});
  const normalizedBodyTemplate = bodyTemplate && typeof bodyTemplate === "object" && !Array.isArray(bodyTemplate)
    ? bodyTemplate
    : null;

  if (!normalizedContributionId && !normalizedPluginKey) {
    const err = new Error("contribution_id or plugin_key is required.");
    err.code = "missing_contribution_selector";
    err.status = 400;
    throw err;
  }
  if (!normalizedActionKey) {
    const err = new Error("action_key is required.");
    err.code = "missing_action_key";
    err.status = 400;
    throw err;
  }
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    const err = new Error("method must be GET, POST, PUT, PATCH, or DELETE.");
    err.code = "invalid_http_method";
    err.status = 400;
    throw err;
  }
  if (!normalizedPath || !normalizedPath.startsWith("/")) {
    const err = new Error("path is required and must start with '/'.");
    err.code = "invalid_http_path";
    err.status = 400;
    throw err;
  }
  if (payloadContainsSecret(normalizedHeaders) || payloadContainsSecret(normalizedBodyTemplate || {})) {
    const err = new Error("Template headers/body_template cannot contain secret-looking keys.");
    err.code = "template_secret_like_key";
    err.status = 400;
    throw err;
  }

  const where = [];
  const params = [];
  if (normalizedContributionId) { where.push("contribution_id = ?"); params.push(normalizedContributionId); }
  if (normalizedPluginKey) { where.push("plugin_key = ?"); params.push(normalizedPluginKey); }
  if (tenantId) { where.push("(owner_tenant_id IS NULL OR owner_tenant_id = ?)"); params.push(compactString(tenantId, 64)); }
  if (userId) { where.push("(owner_user_id IS NULL OR owner_user_id = ?)"); params.push(compactString(userId, 64)); }

  const rows = await safeQuery(
    pool,
    `SELECT * FROM platform_plugin_contributions
      WHERE ${where.join(" AND ")}
      ORDER BY promoted_at DESC, certified_at DESC, updated_at DESC, created_at DESC
      LIMIT 1`,
    params
  );
  let contribution = rows[0] || null;
  if (!contribution) {
    const fallbackRows = await safeQuery(
      pool,
      `SELECT * FROM platform_plugin_contributions
        WHERE JSON_SEARCH(action_bindings_json, 'one', ?, NULL, '$[*].action_key') IS NOT NULL
        ORDER BY promoted_at DESC, certified_at DESC, updated_at DESC, created_at DESC
        LIMIT 20`,
      [normalizedActionKey]
    );
    const fallbackMatches = fallbackRows.filter((row) => {
      if (normalizedContributionId && row.contribution_id === normalizedContributionId) return true;
      if (normalizedPluginKey && row.plugin_key === normalizedPluginKey) return true;
      return false;
    });
    contribution = fallbackMatches[0] || (fallbackRows.length === 1 ? fallbackRows[0] : null);
  }
  if (!contribution) {
    const err = new Error("Platform Plugin contribution not found for template update.");
    err.code = "contribution_not_found";
    err.status = 404;
    throw err;
  }
  if (!TEMPLATE_STATUSES.has(String(contribution.status || ""))) {
    const err = new Error("Contribution status cannot be updated with action templates.");
    err.code = "contribution_status_not_editable";
    err.status = 409;
    throw err;
  }

  const actions = parseStoredJson(contribution.action_bindings_json, []);
  if (!Array.isArray(actions)) {
    const err = new Error("Contribution action_bindings_json must be an array.");
    err.code = "invalid_action_bindings_json";
    err.status = 409;
    throw err;
  }
  const index = actions.findIndex((action) => String(action?.action_key || "") === normalizedActionKey);
  if (index < 0) {
    const err = new Error("Action binding not found in contribution.");
    err.code = "action_binding_not_found";
    err.status = 404;
    throw err;
  }

  const previous = actions[index] || {};
  const updatedAction = {
    ...previous,
    action_key: normalizedActionKey,
    method: normalizedMethod,
    path: normalizedPath,
    headers: normalizedHeaders,
    body_template: normalizedBodyTemplate,
    template_source: "platform_plugin_action_template_upsert",
    template_updated_at: new Date().toISOString(),
  };
  actions[index] = updatedAction;

  const traceId = `platform_plugin_action_template_${randomUUID()}`;
  await pool.query(
    `UPDATE platform_plugin_contributions
        SET action_bindings_json = ?,
            validation_report_json = JSON_SET(COALESCE(validation_report_json, JSON_OBJECT()), '$.action_template', JSON_OBJECT('updated', true, 'action_key', ?, 'method', ?, 'path', ?, 'secrets_included', false, 'updated_at', ?)),
            updated_by = COALESCE(?, updated_by),
            updated_at = CURRENT_TIMESTAMP
      WHERE contribution_id = ?`,
    [
      JSON.stringify(actions),
      normalizedActionKey,
      normalizedMethod,
      normalizedPath,
      new Date().toISOString(),
      compactString(updatedBy || userId, 64) || null,
      contribution.contribution_id,
    ]
  );

  const readbackRows = await safeQuery(
    pool,
    `SELECT contribution_id, plugin_key, status, certification_status, action_bindings_json, updated_at
       FROM platform_plugin_contributions
      WHERE contribution_id = ?
      LIMIT 1`,
    [contribution.contribution_id]
  );
  const readback = readbackRows[0] || null;
  const readbackActions = parseStoredJson(readback?.action_bindings_json, []);
  const readbackAction = Array.isArray(readbackActions)
    ? readbackActions.find((action) => String(action?.action_key || "") === normalizedActionKey)
    : null;
  const success = Boolean(readbackAction?.method === normalizedMethod && readbackAction?.path === normalizedPath);

  const executionLog = await writeTemplateExecutionLog({
    pool,
    traceId,
    status: success ? "success" : "failed_readback",
    payload: {
      contribution_id: contribution.contribution_id,
      plugin_key: contribution.plugin_key,
      action_key: normalizedActionKey,
      method: normalizedMethod,
      path: normalizedPath,
      header_keys: Object.keys(normalizedHeaders),
      has_body_template: Boolean(normalizedBodyTemplate),
    },
  });

  return {
    ok: success,
    contribution: readback ? {
      contribution_id: readback.contribution_id,
      plugin_key: readback.plugin_key,
      status: readback.status,
      certification_status: readback.certification_status || null,
      updated_at: readback.updated_at || null,
    } : null,
    action_template: readbackAction ? safeAction(readbackAction) : null,
    previous_action_template: safeAction(previous),
    readback: { ok: success, table: "platform_plugin_contributions", column: "action_bindings_json" },
    execution_log: executionLog ? {
      ok: true,
      id: executionLog.id,
      execution_status: executionLog.execution_status,
      trace_id: executionLog.execution_trace_id_writeback,
    } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
