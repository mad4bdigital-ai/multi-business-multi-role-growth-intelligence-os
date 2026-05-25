import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const VALID_OWNER_SCOPES = new Set(["tenant", "user"]);
const VALID_TARGETS = new Set(["tenant_private", "user_private", "marketplace_candidate", "platform_base_candidate"]);
const VALID_STATUSES = new Set(["draft", "submitted", "validation_failed", "certified", "rejected", "archived"]);
const EXECUTABLE_PRIVATE_STATUSES = new Set(["draft", "submitted", "validation_failed", "certified"]);
const SECRET_KEY_HINTS = [
  "password", "passwd", "secret", "token", "private_key", "api_key",
  "apikey", "auth_key", "access_token", "refresh_token", "client_secret",
];
const SAFE_POLICY_METADATA_KEYS = new Set([
  "credential_policy",
  "credentialpolicy",
  "credential_policy_json",
  "credentialpolicyjson",
  "credential_source",
  "credentialsource",
  "credential_scope",
  "credentialscope",
  "requested_credential_scope",
  "requestedcredentialscope",
  "allowed_scopes",
  "supported_scopes",
  "fallback_allowed",
]);

function normalize(value = "") {
  return String(value || "").trim();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function normalizeKey(value = "") {
  return normalize(value).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function compactString(value = "", max = 1000) {
  return normalize(value).slice(0, max);
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = normalizeLower(value);
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function safeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function safeJsonArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function parseStoredJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function payloadContainsSecret(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, nested] of Object.entries(current)) {
      const lowerKey = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (!SAFE_POLICY_METADATA_KEYS.has(lowerKey) && SECRET_KEY_HINTS.some((hint) => lowerKey.includes(hint))) return true;
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

async function writeContributionExecutionLog({ pool, traceId, entryType, status, payload }) {
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
      sqlDate(now),
      now,
      now,
      entryType,
      "platform_plugin_contribution",
      "platformPluginContribution",
      payload?.plugin_key ? `platform plugin contribution ${payload.plugin_key}` : "platform plugin contribution",
      entryType,
      "platform_plugin_contribution_intake",
      payload?.execution_mode || "registry_contribution_intake",
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
  const rows = await safeQuery(
    pool,
    `SELECT id, execution_status, execution_trace_id_writeback
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );
  return rows[0] || null;
}

function toSafeContribution(row = {}) {
  return {
    contribution_id: row.contribution_id,
    plugin_key: row.plugin_key,
    display_name: row.display_name,
    plugin_type: row.plugin_type,
    owner_scope: row.owner_scope,
    owner_tenant_id: row.owner_tenant_id || null,
    owner_user_id: row.owner_user_id || null,
    target: row.target,
    base_plugin_key: row.base_plugin_key || null,
    status: row.status,
    certification_status: row.certification_status || "not_started",
    private_execution_enabled: Boolean(row.private_execution_enabled),
    private_activated_at: row.private_activated_at || null,
    manifest_json: parseStoredJson(row.manifest_json, {}),
    protocol_bindings_json: parseStoredJson(row.protocol_bindings_json, []),
    action_bindings_json: parseStoredJson(row.action_bindings_json, []),
    credential_policy_json: parseStoredJson(row.credential_policy_json, {}),
    validation_report_json: parseStoredJson(row.validation_report_json, {}),
    notes: row.notes || "",
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    submitted_at: row.submitted_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function assertTenantAndUser({ pool, tenantId, userId, ownerScope }) {
  if (tenantId) {
    const tenants = await safeQuery(pool, `SELECT tenant_id, status FROM tenants WHERE tenant_id = ? LIMIT 1`, [tenantId]);
    if (!tenants[0] || tenants[0].status !== "active") {
      const err = new Error("Active tenant not found.");
      err.code = "tenant_not_found";
      err.status = 404;
      throw err;
    }
  }
  if (userId) {
    const users = await safeQuery(pool, `SELECT user_id, status FROM users WHERE user_id = ? LIMIT 1`, [userId]);
    if (!users[0] || users[0].status !== "active") {
      const err = new Error("Active user not found.");
      err.code = "user_not_found";
      err.status = 404;
      throw err;
    }
  }
  if (ownerScope === "tenant" && !tenantId) {
    const err = new Error("owner_scope tenant requires tenant_id.");
    err.code = "missing_tenant_id";
    err.status = 400;
    throw err;
  }
  if (ownerScope === "user" && !userId) {
    const err = new Error("owner_scope user requires user_id.");
    err.code = "missing_user_id";
    err.status = 400;
    throw err;
  }
}

function assertContributionOwnerScope(contribution, { tenantId = null, userId = null } = {}) {
  if (!contribution) return false;
  if (contribution.owner_scope === "tenant") return Boolean(tenantId && contribution.owner_tenant_id === tenantId);
  if (contribution.owner_scope === "user") return Boolean(userId && contribution.owner_user_id === userId);
  return false;
}

function findContributionAction(contribution, actionKey = null) {
  const actions = safeJsonArray(contribution.action_bindings_json, []);
  if (!actionKey) return actions[0] || null;
  return actions.find((action) => String(action.action_key || "") === String(actionKey)) || null;
}

function contributionProtocols(contribution) {
  return safeJsonArray(contribution.protocol_bindings_json, [])
    .map((binding) => binding.protocol)
    .filter(Boolean);
}

function contributionCredentialScopes(contribution) {
  const policy = safeJsonObject(contribution.credential_policy_json, {});
  const allowed = Array.isArray(policy.allowed_scopes) ? policy.allowed_scopes : [];
  const supported = Array.isArray(policy.supported_scopes) ? policy.supported_scopes : [];
  return [...new Set([...allowed, ...supported].map((scope) => String(scope || "").trim()).filter(Boolean))];
}

export async function createPlatformPluginContribution({
  pool = getPool(),
  tenantId = null,
  userId = null,
  ownerScope = "tenant",
  target = null,
  pluginKey,
  displayName,
  pluginType = "rest_api",
  basePluginKey = null,
  manifest = {},
  protocolBindings = [],
  actionBindings = [],
  credentialPolicy = {},
  notes = "",
  submit = false,
  rawPayload = null,
} = {}) {
  if (rawPayload && payloadContainsSecret(rawPayload)) {
    const err = new Error("Secrets are not accepted in Platform Plugin contributions. Use credential intake or OAuth after certification.");
    err.code = "secrets_not_allowed";
    err.status = 400;
    throw err;
  }

  const normalizedOwnerScope = normalizeKey(ownerScope || "tenant");
  if (!VALID_OWNER_SCOPES.has(normalizedOwnerScope)) {
    const err = new Error("owner_scope must be tenant or user.");
    err.code = "invalid_owner_scope";
    err.status = 400;
    throw err;
  }
  const normalizedTarget = normalizeKey(target || (normalizedOwnerScope === "user" ? "user_private" : "tenant_private"));
  if (!VALID_TARGETS.has(normalizedTarget)) {
    const err = new Error("target is not valid for Platform Plugin contribution intake.");
    err.code = "invalid_target";
    err.status = 400;
    throw err;
  }

  await assertTenantAndUser({ pool, tenantId, userId, ownerScope: normalizedOwnerScope });

  const normalizedPluginKey = normalizeKey(pluginKey);
  if (!normalizedPluginKey) {
    const err = new Error("plugin_key is required.");
    err.code = "missing_plugin_key";
    err.status = 400;
    throw err;
  }
  if (!displayName) {
    const err = new Error("display_name is required.");
    err.code = "missing_display_name";
    err.status = 400;
    throw err;
  }

  const baseRows = await safeQuery(pool, `SELECT app_key FROM app_integrations WHERE app_key = ? LIMIT 1`, [normalizedPluginKey]);
  if (baseRows[0]) {
    const err = new Error("plugin_key already exists in Platform Base. Submit a variant using base_plugin_key and a distinct plugin_key.");
    err.code = "base_plugin_key_conflict";
    err.status = 409;
    throw err;
  }

  const normalizedBasePluginKey = basePluginKey ? normalizeKey(basePluginKey) : null;
  if (normalizedBasePluginKey) {
    const basePluginRows = await safeQuery(pool, `SELECT app_key FROM app_integrations WHERE app_key = ? LIMIT 1`, [normalizedBasePluginKey]);
    if (!basePluginRows[0]) {
      const err = new Error("base_plugin_key does not exist in Platform Base.");
      err.code = "base_plugin_not_found";
      err.status = 404;
      throw err;
    }
  }

  const contributionId = randomUUID();
  const traceId = `platform_plugin_contribution_${contributionId}`;
  const status = submit ? "submitted" : "draft";

  await pool.query(
    `INSERT INTO platform_plugin_contributions
       (contribution_id, plugin_key, display_name, plugin_type, owner_scope,
        owner_tenant_id, owner_user_id, target, base_plugin_key, status,
        certification_status, manifest_json, protocol_bindings_json,
        action_bindings_json, credential_policy_json, validation_report_json,
        notes, created_by, updated_by, submitted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      contributionId,
      normalizedPluginKey,
      compactString(displayName, 255),
      normalizeKey(pluginType || "rest_api"),
      normalizedOwnerScope,
      tenantId || null,
      userId || null,
      normalizedTarget,
      normalizedBasePluginKey,
      status,
      "not_started",
      JSON.stringify(safeJsonObject(manifest, {})),
      JSON.stringify(safeJsonArray(protocolBindings, [])),
      JSON.stringify(safeJsonArray(actionBindings, [])),
      JSON.stringify(safeJsonObject(credentialPolicy, {})),
      JSON.stringify({ intake: "accepted", checked_at: isoNow(), secrets_included: false }),
      compactString(notes, 2000),
      userId || null,
      userId || null,
      submit ? isoNow() : null,
    ]
  );

  const rows = await safeQuery(
    pool,
    `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`,
    [contributionId]
  );
  const readback = rows[0] ? toSafeContribution(rows[0]) : null;
  const executionLog = await writeContributionExecutionLog({
    pool,
    traceId,
    entryType: "platform_plugin_contribution_create",
    status: readback ? "success" : "failed_readback",
    payload: {
      contribution_id: contributionId,
      plugin_key: normalizedPluginKey,
      owner_scope: normalizedOwnerScope,
      tenant_id: tenantId || null,
      user_id: userId || null,
      target: normalizedTarget,
      contribution_status: status,
    },
  });

  return {
    ok: Boolean(readback),
    contribution: readback,
    readback: { ok: Boolean(readback), table: "platform_plugin_contributions" },
    execution_log: executionLog ? {
      ok: true,
      id: executionLog.id,
      execution_status: executionLog.execution_status,
      trace_id: executionLog.execution_trace_id_writeback,
    } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}

export async function activatePrivatePlatformPluginContribution({
  pool = getPool(),
  contributionId,
  tenantId = null,
  userId = null,
  notes = "",
} = {}) {
  const normalizedId = compactString(contributionId, 64);
  if (!normalizedId) {
    const err = new Error("contribution_id is required.");
    err.code = "missing_contribution_id";
    err.status = 400;
    throw err;
  }
  const rows = await safeQuery(pool, `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`, [normalizedId]);
  const contribution = rows[0] ? toSafeContribution(rows[0]) : null;
  if (!contribution) {
    const err = new Error("Platform Plugin contribution not found.");
    err.code = "contribution_not_found";
    err.status = 404;
    throw err;
  }
  if (!assertContributionOwnerScope(contribution, { tenantId, userId })) {
    const err = new Error("Contribution is not owned by the supplied tenant/user scope.");
    err.code = "owner_scope_mismatch";
    err.status = 403;
    throw err;
  }
  if (!EXECUTABLE_PRIVATE_STATUSES.has(contribution.status)) {
    const err = new Error("Contribution status cannot be privately activated.");
    err.code = "contribution_not_executable";
    err.status = 409;
    throw err;
  }
  if (!contribution.action_bindings_json.length) {
    const err = new Error("At least one action binding is required for private execution activation.");
    err.code = "missing_action_bindings";
    err.status = 400;
    throw err;
  }
  if (!contribution.protocol_bindings_json.length) {
    const err = new Error("At least one protocol binding is required for private execution activation.");
    err.code = "missing_protocol_bindings";
    err.status = 400;
    throw err;
  }

  await pool.query(
    `UPDATE platform_plugin_contributions
        SET private_execution_enabled = 1,
            private_activated_at = CURRENT_TIMESTAMP,
            validation_report_json = JSON_SET(COALESCE(validation_report_json, JSON_OBJECT()), '$.private_activation', JSON_OBJECT('enabled', true, 'checked_at', ?, 'scope', owner_scope, 'secrets_included', false)),
            notes = CASE WHEN ? = '' THEN notes ELSE CONCAT(COALESCE(notes,''), '\n', ?) END,
            updated_by = COALESCE(?, updated_by)
      WHERE contribution_id = ?`,
    [isoNow(), compactString(notes, 1000), compactString(notes, 1000), userId || null, normalizedId]
  );

  const readbackRows = await safeQuery(pool, `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`, [normalizedId]);
  const readback = readbackRows[0] ? toSafeContribution(readbackRows[0]) : null;
  const traceId = `platform_plugin_private_activate_${normalizedId}`;
  const executionLog = await writeContributionExecutionLog({
    pool,
    traceId,
    entryType: "platform_plugin_contribution_private_activate",
    status: readback?.private_execution_enabled ? "success" : "failed_readback",
    payload: {
      contribution_id: normalizedId,
      plugin_key: contribution.plugin_key,
      owner_scope: contribution.owner_scope,
      tenant_id: tenantId || null,
      user_id: userId || null,
      private_execution_enabled: Boolean(readback?.private_execution_enabled),
      execution_mode: "owner_scoped_private_runtime",
    },
  });

  return {
    ok: Boolean(readback?.private_execution_enabled),
    contribution: readback,
    private_runtime: {
      executable_within_owner_scope: Boolean(readback?.private_execution_enabled),
      promotion_required_for_other_users: true,
      platform_base_mutated: false,
    },
    execution_log: executionLog ? {
      ok: true,
      id: executionLog.id,
      execution_status: executionLog.execution_status,
      trace_id: executionLog.execution_trace_id_writeback,
    } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}

export async function resolvePrivatePlatformPluginContribution({
  pool = getPool(),
  contributionId = null,
  pluginKey = null,
  actionKey = null,
  tenantId = null,
  userId = null,
  requestedCredentialScope = null,
} = {}) {
  const where = [];
  const params = [];
  if (contributionId) { where.push("contribution_id = ?"); params.push(compactString(contributionId, 64)); }
  if (pluginKey) { where.push("plugin_key = ?"); params.push(normalizeKey(pluginKey)); }
  if (!where.length) {
    const err = new Error("contribution_id or plugin_key is required.");
    err.code = "missing_contribution_selector";
    err.status = 400;
    throw err;
  }
  const rows = await safeQuery(
    pool,
    `SELECT * FROM platform_plugin_contributions WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
    params
  );
  const contribution = rows[0] ? toSafeContribution(rows[0]) : null;
  if (!contribution) {
    return { ok: true, allowed: false, reason: "contribution_not_found", secrets_included: false };
  }

  const ownerOk = assertContributionOwnerScope(contribution, { tenantId, userId });
  const action = findContributionAction(contribution, actionKey);
  const protocols = contributionProtocols(contribution);
  const credentialScopes = contributionCredentialScopes(contribution);
  const requestedScope = requestedCredentialScope ? normalizeKey(requestedCredentialScope) : null;
  const credentialOk = !credentialScopes.length || !requestedScope || credentialScopes.includes(requestedScope);
  const allowed = Boolean(ownerOk && contribution.private_execution_enabled && action && credentialOk && EXECUTABLE_PRIVATE_STATUSES.has(contribution.status));
  const denialReasons = [];
  if (!ownerOk) denialReasons.push("owner_scope_mismatch");
  if (!contribution.private_execution_enabled) denialReasons.push("private_execution_not_enabled");
  if (!EXECUTABLE_PRIVATE_STATUSES.has(contribution.status)) denialReasons.push("contribution_status_not_executable");
  if (!action) denialReasons.push("action_binding_not_found");
  if (!credentialOk) denialReasons.push("credential_scope_not_allowed_by_contribution_policy");

  return {
    ok: true,
    allowed,
    reason: allowed ? "owner_scoped_private_runtime_resolved" : denialReasons.join("|") || "not_allowed",
    mode: "owner_scoped_private_runtime",
    contribution_id: contribution.contribution_id,
    plugin_key: contribution.plugin_key,
    plugin: {
      plugin_key: contribution.plugin_key,
      display_name: contribution.display_name,
      plugin_type: contribution.plugin_type,
      source: "tenant_user_contribution",
      owner_scope: contribution.owner_scope,
      status: contribution.status,
      certification_status: contribution.certification_status,
      private_execution_enabled: contribution.private_execution_enabled,
      protocols,
    },
    binding: action ? {
      action_key: action.action_key || null,
      risk_level: action.risk_level || null,
      status: action.status || "active_by_contribution",
    } : null,
    credential_resolution: {
      ok: credentialOk,
      requested_scope: requestedScope || null,
      allowed_scopes: credentialScopes,
      reason: credentialOk ? "credential_policy_allows_scope" : "credential_scope_not_allowed_by_contribution_policy",
      secrets_included: false,
    },
    execution: {
      will_execute: allowed,
      next_step: allowed ? "owner_scoped_private_adapter_dispatch" : "resolve_denials_before_private_execution",
      promotion_required_for_other_users: true,
      platform_base_mutated: false,
    },
    audit: {
      secrets_included: false,
      read_model_tables: ["platform_plugin_contributions"],
    },
    secrets_included: false,
  };
}

export async function listPlatformPluginContributions({
  pool = getPool(),
  tenantId = null,
  userId = null,
  status = null,
  limit = 50,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 50));
  const where = [];
  const params = [];
  if (tenantId) { where.push("owner_tenant_id = ?"); params.push(tenantId); }
  if (userId) { where.push("owner_user_id = ?"); params.push(userId); }
  if (status) {
    const normalizedStatus = normalizeKey(status);
    if (!VALID_STATUSES.has(normalizedStatus)) {
      const err = new Error("Invalid contribution status filter.");
      err.code = "invalid_status";
      err.status = 400;
      throw err;
    }
    where.push("status = ?"); params.push(normalizedStatus);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await safeQuery(
    pool,
    `SELECT * FROM platform_plugin_contributions
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?`,
    [...params, boundedLimit]
  );
  return {
    ok: true,
    count: rows.length,
    contributions: rows.map(toSafeContribution),
    secrets_included: false,
  };
}

export async function getPlatformPluginContribution({ pool = getPool(), contributionId } = {}) {
  const normalizedId = compactString(contributionId, 64);
  if (!normalizedId) {
    const err = new Error("contribution_id is required.");
    err.code = "missing_contribution_id";
    err.status = 400;
    throw err;
  }
  const rows = await safeQuery(
    pool,
    `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`,
    [normalizedId]
  );
  if (!rows[0]) {
    return { ok: false, error: { code: "contribution_not_found", message: "Platform Plugin contribution not found." }, secrets_included: false };
  }
  return { ok: true, contribution: toSafeContribution(rows[0]), secrets_included: false };
}
