import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const VALID_SOURCE_MODES = new Set(["managed", "dedicated"]);
const SECRET_KEY_HINTS = [
  "password", "passwd", "secret", "token", "credential", "private_key", "api_key",
  "apikey", "auth_key", "access_token", "refresh_token", "client_secret",
];

function normalize(value = "") {
  return String(value || "").trim();
}

function normalizeKey(value = "") {
  return normalize(value).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = normalize(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizeSourceMode(value = "managed") {
  const normalized = normalizeKey(value);
  if (normalized === "managed" || normalized === "platform" || normalized === "platform_managed") return "managed";
  if (normalized === "dedicated" || normalized === "tenant" || normalized === "tenant_owned" || normalized === "customer_owned") return "dedicated";
  return normalized;
}

function compactString(value = "", max = 1000) {
  return normalize(value).slice(0, max);
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

function isoNow() {
  return new Date().toISOString();
}

function sqlDate(iso) {
  return String(iso || isoNow()).slice(0, 10);
}

async function writePolicyExecutionLog({ pool, traceId, tenantId, userId, pluginKey, policy, readback, skipSurfaceAuthority = false }) {
  const output = {
    tenant_id: tenantId,
    user_id: userId || null,
    plugin_key: pluginKey,
    policy,
    readback: readback ? {
      tenant_id: readback.tenant_id,
      app_key: readback.app_key,
      source_mode: readback.source_mode,
      fallback_allowed: Boolean(readback.fallback_allowed),
      required_for_device_install: Boolean(readback.required_for_device_install),
      status: readback.status,
      source: readback.source || null,
    } : null,
    secrets_included: false,
  };
  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "platform_plugin_policy_upsert",
    executionClass: "platform_plugin_policy",
    sourceLayer: "platformPluginPolicy",
    userInput: `upsert policy for ${pluginKey}`,
    routeKeys: "platform_plugin_policy_upsert",
    selectedWorkflows: "platform_plugin_policy_overlay",
    executionMode: "registry_policy_mutation",
    decisionTrigger: "admin_tool",
    executionStatus: readback ? "success" : "failed_readback",
    outputSummary: output,
    recoveryStatus: "not_required",
    routeStatus: "resolved",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: readback ? "ready" : "degraded",
    logSource: "sql_primary",
    skipSurfaceAuthority,
  });
  return evidence.row || null;
}

export async function upsertPlatformPluginPolicy({
  pool = getPool(),
  tenantId,
  pluginKey,
  sourceMode = "managed",
  fallbackAllowed = false,
  requiredForDeviceInstall = false,
  notes = "",
  userId = null,
  source = "platform_plugin_policy_upsert",
  rawPayload = null,
} = {}) {
  if (rawPayload && payloadContainsSecret(rawPayload)) {
    const err = new Error("Secrets are not accepted by Platform Plugin policy upsert. Use credential intake or OAuth.");
    err.code = "secrets_not_allowed";
    err.status = 400;
    throw err;
  }

  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedPluginKey = normalizeKey(pluginKey);
  const normalizedMode = normalizeSourceMode(sourceMode);
  if (!normalizedTenantId) {
    const err = new Error("tenant_id is required.");
    err.code = "missing_tenant_id";
    err.status = 400;
    throw err;
  }
  if (!normalizedPluginKey) {
    const err = new Error("plugin_key is required.");
    err.code = "missing_plugin_key";
    err.status = 400;
    throw err;
  }
  if (!VALID_SOURCE_MODES.has(normalizedMode)) {
    const err = new Error("source_mode must be managed or dedicated.");
    err.code = "invalid_source_mode";
    err.status = 400;
    throw err;
  }

  const tenantRows = await safeQuery(
    pool,
    `SELECT tenant_id, display_name, status FROM tenants WHERE tenant_id = ? LIMIT 1`,
    [normalizedTenantId]
  );
  if (!tenantRows[0] || tenantRows[0].status !== "active") {
    const err = new Error("Active tenant not found.");
    err.code = "tenant_not_found";
    err.status = 404;
    throw err;
  }

  const pluginRows = await safeQuery(
    pool,
    `SELECT app_key, display_name, status FROM app_integrations WHERE app_key = ? LIMIT 1`,
    [normalizedPluginKey]
  );
  const plugin = pluginRows[0] || null;
  if (!plugin) {
    const err = new Error("Platform Plugin not found in app_integrations.");
    err.code = "plugin_not_found";
    err.status = 404;
    throw err;
  }
  if (!["active", "beta"].includes(String(plugin.status || "").toLowerCase())) {
    const err = new Error("Platform Plugin is not active or beta.");
    err.code = "plugin_not_active";
    err.status = 409;
    throw err;
  }

  const policy = {
    source_mode: normalizedMode,
    fallback_allowed: boolValue(fallbackAllowed, normalizedMode === "managed"),
    required_for_device_install: boolValue(requiredForDeviceInstall, false),
    notes: compactString(notes, 1000),
    status: "active",
    source: compactString(source, 120) || "platform_plugin_policy_upsert",
  };
  const traceId = `platform_plugin_policy_${randomUUID()}`;

  await pool.query(
    `INSERT INTO tenant_integration_policies
       (tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install,
        notes, status, created_by, updated_by, source)
     VALUES (?,?,?,?,? ,?,'active',?,?,?)
     ON DUPLICATE KEY UPDATE
       source_mode = VALUES(source_mode),
       fallback_allowed = VALUES(fallback_allowed),
       required_for_device_install = VALUES(required_for_device_install),
       notes = VALUES(notes),
       status = 'active',
       updated_by = VALUES(updated_by),
       source = VALUES(source),
       updated_at = CURRENT_TIMESTAMP`,
    [
      normalizedTenantId,
      normalizedPluginKey,
      policy.source_mode,
      policy.fallback_allowed ? 1 : 0,
      policy.required_for_device_install ? 1 : 0,
      policy.notes,
      userId || null,
      userId || null,
      policy.source,
    ]
  );

  const readbackRows = await safeQuery(
    pool,
    `SELECT tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install,
            notes, status, source, created_by, updated_by, created_at, updated_at
       FROM tenant_integration_policies
      WHERE tenant_id = ? AND app_key = ? AND status = 'active'
      LIMIT 1`,
    [normalizedTenantId, normalizedPluginKey]
  );
  const readback = readbackRows[0] || null;
  const readbackOk = Boolean(readback && readback.source_mode === policy.source_mode);
  const executionLog = await writePolicyExecutionLog({
    pool,
    traceId,
    tenantId: normalizedTenantId,
    userId,
    pluginKey: normalizedPluginKey,
    policy,
    readback,
  });

  return {
    ok: readbackOk,
    plugin: {
      plugin_key: plugin.app_key,
      display_name: plugin.display_name,
      status: plugin.status,
    },
    tenant: {
      tenant_id: tenantRows[0].tenant_id,
      display_name: tenantRows[0].display_name,
      status: tenantRows[0].status,
    },
    policy: readback ? {
      tenant_id: readback.tenant_id,
      plugin_key: readback.app_key,
      source_mode: readback.source_mode,
      fallback_allowed: Boolean(readback.fallback_allowed),
      required_for_device_install: Boolean(readback.required_for_device_install),
      notes: readback.notes || "",
      status: readback.status,
      source: readback.source || null,
      updated_at: readback.updated_at || null,
    } : null,
    readback: {
      ok: readbackOk,
      table: "tenant_integration_policies",
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
