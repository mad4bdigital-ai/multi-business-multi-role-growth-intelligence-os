import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const SECRET_KEY_HINTS = [
  "password", "passwd", "secret", "token", "credential", "private_key", "api_key",
  "apikey", "auth_key", "access_token", "refresh_token", "client_secret",
];
const VALID_GRANT_MODES = new Set(["explicit", "default_permissive", "auto_approved"]);

function compactString(value = "", max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKey(value = "", max = 255) {
  return compactString(value, max).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function payloadContainsSecret(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, nested] of Object.entries(current)) {
      const lowerKey = String(key || "").toLowerCase();
      if (SECRET_KEY_HINTS.some((hint) => lowerKey.includes(hint))) return true;
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

function normalizeDateTime(value) {
  const raw = compactString(value, 64);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error("expires_at must be a valid date-time value.");
    err.code = "invalid_expires_at";
    err.status = 400;
    throw err;
  }
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

async function writeActionGrantExecutionLog({ pool, traceId, grant, connection, request }) {
  const output = {
    grant: grant ? {
      grant_id: grant.grant_id,
      connection_id: grant.connection_id,
      workspace_id: grant.workspace_id || null,
      agent_id: grant.agent_id || null,
      app_key: grant.app_key,
      action_key: grant.action_key,
      grant_mode: grant.grant_mode,
      status: grant.status,
      expires_at: grant.expires_at || null,
    } : null,
    connection: connection ? {
      connection_id: connection.connection_id,
      tenant_id: connection.tenant_id,
      user_id: connection.user_id,
      app_key: connection.app_key,
      status: connection.status,
      validation_status: connection.validation_status || null,
    } : null,
    request: {
      plugin_key: request.plugin_key,
      action_key: request.action_key,
      agent_id: request.agent_id || null,
      workspace_id: request.workspace_id || null,
    },
    secrets_included: false,
  };
  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "platform_plugin_action_grant_upsert",
    executionClass: "platform_plugin_action_grant",
    sourceLayer: "platformPluginActionGrant",
    userInput: `upsert action grant for ${request.plugin_key}:${request.action_key}`,
    routeKeys: "platform_plugin_action_grant_upsert",
    selectedWorkflows: "platform_plugin_action_approval_gate",
    executionMode: "registry_policy_mutation",
    decisionTrigger: "admin_tool",
    executionStatus: grant ? "success" : "failed_readback",
    outputSummary: output,
    recoveryStatus: "not_required",
    routeStatus: "resolved",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: grant ? "ready" : "degraded",
    logSource: "sql_primary",
  });
  return evidence.row || null;
}

export async function upsertPlatformPluginActionGrant({
  pool = getPool(),
  connectionId,
  pluginKey,
  actionKey,
  agentId = null,
  workspaceId = null,
  grantMode = "explicit",
  grantedBy = null,
  expiresAt = null,
  tenantId = null,
  userId = null,
  rawPayload = null,
} = {}) {
  if (rawPayload && payloadContainsSecret(rawPayload)) {
    const err = new Error("Secrets are not accepted by Platform Plugin action grants.");
    err.code = "secrets_not_allowed";
    err.status = 400;
    throw err;
  }

  const normalizedConnectionId = compactString(connectionId, 36);
  const normalizedPluginKey = normalizeKey(pluginKey, 128);
  const normalizedActionKey = normalizeKey(actionKey, 128);
  const normalizedAgentId = compactString(agentId, 36) || null;
  const normalizedWorkspaceId = compactString(workspaceId, 36) || null;
  const normalizedGrantedBy = compactString(grantedBy || userId, 36) || null;
  const normalizedTenantId = compactString(tenantId, 64) || null;
  const normalizedUserId = compactString(userId, 64) || null;
  const normalizedGrantMode = normalizeKey(grantMode, 64) || "explicit";
  const normalizedExpiresAt = normalizeDateTime(expiresAt);

  if (!normalizedConnectionId) {
    const err = new Error("connection_id is required.");
    err.code = "missing_connection_id";
    err.status = 400;
    throw err;
  }
  if (!normalizedPluginKey) {
    const err = new Error("plugin_key is required.");
    err.code = "missing_plugin_key";
    err.status = 400;
    throw err;
  }
  if (!normalizedActionKey) {
    const err = new Error("action_key is required.");
    err.code = "missing_action_key";
    err.status = 400;
    throw err;
  }
  if (!VALID_GRANT_MODES.has(normalizedGrantMode)) {
    const err = new Error("grant_mode must be explicit, default_permissive, or auto_approved.");
    err.code = "invalid_grant_mode";
    err.status = 400;
    throw err;
  }

  const pluginRows = await safeQuery(
    pool,
    `SELECT app_key, display_name, status FROM app_integrations WHERE app_key = ? LIMIT 1`,
    [normalizedPluginKey]
  );
  const plugin = pluginRows[0] || null;
  if (!plugin || !["active", "beta"].includes(String(plugin.status || "").toLowerCase())) {
    const err = new Error("Active or beta Platform Plugin not found.");
    err.code = plugin ? "plugin_not_active" : "plugin_not_found";
    err.status = plugin ? 409 : 404;
    throw err;
  }

  const bindingRows = await safeQuery(
    pool,
    `SELECT binding_id, status, exposure_default
       FROM app_integration_action_bindings
      WHERE app_key = ? AND action_key = ? AND status = 'active'
      LIMIT 1`,
    [normalizedPluginKey, normalizedActionKey]
  );
  if (!bindingRows[0]) {
    const err = new Error("Active Platform Plugin action binding not found.");
    err.code = "action_binding_not_found";
    err.status = 404;
    throw err;
  }

  const connectionRows = await safeQuery(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, status, validation_status
       FROM user_app_connections
      WHERE connection_id = ?
        AND app_key = ?
        AND status = 'active'
        ${normalizedTenantId ? "AND tenant_id = ?" : ""}
        ${normalizedUserId ? "AND user_id = ?" : ""}
      LIMIT 1`,
    [normalizedConnectionId, normalizedPluginKey, ...(normalizedTenantId ? [normalizedTenantId] : []), ...(normalizedUserId ? [normalizedUserId] : [])]
  );
  const connection = connectionRows[0] || null;
  if (!connection) {
    const err = new Error("Active user app connection not found for plugin action grant.");
    err.code = "connection_not_found";
    err.status = 404;
    throw err;
  }

  const grantId = randomUUID();
  const traceId = `platform_plugin_action_grant_${randomUUID()}`;
  await pool.query(
    `INSERT INTO app_action_grants
       (grant_id, connection_id, workspace_id, agent_id, app_key, action_key, grant_mode, granted_by, expires_at, status)
     VALUES (?,?,?,?,?,?,?,?,?,'active')
     ON DUPLICATE KEY UPDATE
       grant_mode = VALUES(grant_mode),
       granted_by = VALUES(granted_by),
       expires_at = VALUES(expires_at),
       status = 'active'`,
    [
      grantId,
      normalizedConnectionId,
      normalizedWorkspaceId,
      normalizedAgentId,
      normalizedPluginKey,
      normalizedActionKey,
      normalizedGrantMode,
      normalizedGrantedBy,
      normalizedExpiresAt,
    ]
  );

  const readbackRows = await safeQuery(
    pool,
    `SELECT grant_id, connection_id, workspace_id, agent_id, app_key, action_key,
            grant_mode, granted_by, expires_at, status, created_at
       FROM app_action_grants
      WHERE connection_id = ?
        AND app_key = ?
        AND action_key = ?
        AND status = 'active'
        AND (workspace_id <=> ?)
        AND (agent_id <=> ?)
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedConnectionId, normalizedPluginKey, normalizedActionKey, normalizedWorkspaceId, normalizedAgentId]
  );
  const grant = readbackRows[0] || null;
  const executionLog = await writeActionGrantExecutionLog({
    pool,
    traceId,
    grant,
    connection,
    request: {
      plugin_key: normalizedPluginKey,
      action_key: normalizedActionKey,
      agent_id: normalizedAgentId,
      workspace_id: normalizedWorkspaceId,
    },
  });

  return {
    ok: Boolean(grant),
    plugin: {
      plugin_key: plugin.app_key,
      display_name: plugin.display_name,
      status: plugin.status,
    },
    connection: {
      connection_id: connection.connection_id,
      tenant_id: connection.tenant_id,
      user_id: connection.user_id,
      app_key: connection.app_key,
      status: connection.status,
      validation_status: connection.validation_status || null,
    },
    grant: grant ? {
      grant_id: grant.grant_id,
      connection_id: grant.connection_id,
      workspace_id: grant.workspace_id || null,
      agent_id: grant.agent_id || null,
      plugin_key: grant.app_key,
      action_key: grant.action_key,
      grant_mode: grant.grant_mode,
      granted_by: grant.granted_by || null,
      expires_at: grant.expires_at || null,
      status: grant.status,
    } : null,
    readback: {
      ok: Boolean(grant),
      table: "app_action_grants",
    },
    execution_log: executionLog ? {
      ok: true,
      id: executionLog.id,
      execution_status: executionLog.execution_status,
      trace_id: executionLog.execution_trace_id_writeback,
    } : {
      ok: false,
      trace_id: traceId,
    },
    secrets_included: false,
  };
}
