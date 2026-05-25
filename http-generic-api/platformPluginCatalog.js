import { getPool } from "./db.js";

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function compactString(value = "", max = 500) {
  return String(value || "").trim().slice(0, max);
}

function normalizeStatus(value = "") {
  return String(value || "").trim().toLowerCase() || "unknown";
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function inferProtocols(row = {}) {
  const authType = normalizeStatus(row.auth_type);
  const protocols = [];
  if (["oauth2", "client_credentials"].includes(authType)) protocols.push("oauth2");
  if (["api_key", "basic_auth", "bearer_token", "custom_headers", "oauth2", "client_credentials"].includes(authType)) protocols.push("rest");
  if (authType === "webhook") protocols.push("webhook");
  if (authType === "mcp" || row.mcp_server_info) protocols.push("mcp");
  return unique(protocols.length ? protocols : ["rest"]);
}

function inferPluginType(row = {}) {
  const category = normalizeStatus(row.category);
  const authType = normalizeStatus(row.auth_type);
  if (authType === "mcp" || row.mcp_server_info) return "mcp_server";
  if (authType === "webhook") return "webhook";
  if (category.includes("browser")) return "browser_automation";
  if (category.includes("ai") || category.includes("model")) return "ai_provider";
  if (category.includes("workflow") || String(row.app_key || "").includes("n8n")) return "workflow_engine";
  if (authType === "oauth2") return "oauth_app";
  return "rest_api";
}

function inferSupportedCredentialScopes({ plugin = {}, actionBindings = [], toolBindings = [] } = {}) {
  const scopes = [];
  const authType = normalizeStatus(plugin.auth_type);
  const bindingCredentialSources = [...actionBindings, ...toolBindings]
    .map((binding) => binding.credential_source)
    .filter(Boolean);
  for (const source of bindingCredentialSources) {
    const normalized = normalizeStatus(source);
    if (normalized === "user_connection") scopes.push("user_connection");
    if (normalized === "tenant_connection") scopes.push("tenant_connection");
    if (normalized === "platform_managed") scopes.push("platform_managed");
    if (normalized === "device_connector") scopes.push("device_connector");
    if (normalized === "none") scopes.push("none");
  }
  if (["oauth2", "api_key", "bearer_token", "basic_auth", "client_credentials", "custom_headers"].includes(authType)) {
    scopes.push("user_connection", "tenant_connection", "platform_managed");
  }
  if (authType === "mcp") scopes.push("user_connection", "tenant_connection", "device_connector");
  if (authType === "webhook") scopes.push("tenant_connection", "user_connection");
  return unique(scopes.length ? scopes : ["platform_managed"]);
}

function indexByAppKey(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.app_key || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function placeholders(values = []) {
  return values.map(() => "?").join(", ");
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

export function normalizePlatformPlugin(row = {}, context = {}) {
  const actionBindings = context.actionBindings || [];
  const toolBindings = context.toolBindings || [];
  const tenantPolicies = context.tenantPolicies || [];
  const userConnectionSummary = context.userConnectionSummary || [];
  const protocols = inferProtocols(row);
  const pluginType = inferPluginType(row);
  const supportedCredentialScopes = inferSupportedCredentialScopes({ plugin: row, actionBindings, toolBindings });

  return {
    plugin_key: row.app_key,
    display_name: row.display_name,
    description: compactString(row.description, 1000),
    plugin_family: row.category || "app_integration",
    plugin_type: pluginType,
    source: "platform_preset",
    status: row.status,
    protocols,
    docs_url: row.docs_url || null,
    manifest: {
      default_action_grants: safeJsonParse(row.default_action_grants, []),
      mcp_server_info_present: Boolean(row.mcp_server_info),
      current_storage: {
        definition_table: "app_integrations",
        action_binding_table: "app_integration_action_bindings",
        tool_binding_table: "app_integration_tool_bindings",
        tenant_policy_table: "tenant_integration_policies",
        user_connection_table: "user_app_connections",
      },
    },
    credential_resolver_policy: {
      default_auth_type: row.auth_type,
      supported_scopes: supportedCredentialScopes,
      fallback_default: supportedCredentialScopes.includes("platform_managed"),
      secrets_included: false,
    },
    action_bindings: actionBindings.map((binding) => ({
      binding_id: binding.binding_id,
      action_key: binding.action_key,
      binding_role: binding.binding_role,
      credential_source: binding.credential_source,
      exposure_default: binding.exposure_default,
      status: binding.status,
    })),
    tool_bindings: toolBindings.map((binding) => ({
      binding_id: binding.binding_id,
      tool_key: binding.tool_key,
      tool_surface: binding.tool_surface,
      binding_role: binding.binding_role,
      credential_source: binding.credential_source,
      exposure_scope: binding.exposure_scope,
      status: binding.status,
    })),
    tenant_policies: tenantPolicies.map((policy) => ({
      tenant_id: policy.tenant_id,
      source_mode: policy.source_mode,
      fallback_allowed: Boolean(policy.fallback_allowed),
      required_for_device_install: Boolean(policy.required_for_device_install),
      status: policy.status,
      source: policy.source || null,
      updated_at: policy.updated_at || null,
    })),
    user_connection_summary: userConnectionSummary.map((summary) => ({
      tenant_id: summary.tenant_id,
      user_id: summary.user_id || null,
      auth_type: summary.auth_type,
      status: summary.status,
      validation_status: summary.validation_status || null,
      connection_count: Number(summary.connection_count || 0),
      last_validated_at: summary.last_validated_at || null,
      last_used_at: summary.last_used_at || null,
    })),
    secrets_included: false,
  };
}

export async function loadPlatformPluginCatalog({
  pool = getPool(),
  tenantId = null,
  userId = null,
  includeInactive = false,
  includeBindings = true,
  limit = 100,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(250, Number.parseInt(limit, 10) || 100));
  const statusFilter = includeInactive ? "" : "WHERE ai.status <> 'deprecated'";
  const appRows = await safeQuery(
    pool,
    `SELECT ai.app_key, ai.display_name, ai.description, ai.auth_type, ai.oauth_scopes_default,
            ai.mcp_server_info, ai.docs_url, ai.category, ai.default_action_grants, ai.status, ai.created_at
       FROM app_integrations ai
       ${statusFilter}
       ORDER BY ai.app_key ASC
       LIMIT ?`,
    [boundedLimit]
  );

  const appKeys = appRows.map((row) => String(row.app_key || "").trim()).filter(Boolean);
  let actionRows = [];
  let toolRows = [];
  let tenantPolicyRows = [];
  let userConnectionRows = [];

  if (appKeys.length && includeBindings) {
    const inClause = placeholders(appKeys);
    actionRows = await safeQuery(
      pool,
      `SELECT binding_id, app_key, action_key, binding_role, credential_source, exposure_default, status, notes
         FROM app_integration_action_bindings
        WHERE app_key IN (${inClause})
        ORDER BY app_key ASC, action_key ASC`,
      appKeys
    );
    toolRows = await safeQuery(
      pool,
      `SELECT binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes
         FROM app_integration_tool_bindings
        WHERE app_key IN (${inClause})
        ORDER BY app_key ASC, tool_key ASC`,
      appKeys
    );
  }

  if (appKeys.length && tenantId) {
    const inClause = placeholders(appKeys);
    tenantPolicyRows = await safeQuery(
      pool,
      `SELECT tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install, status, source, updated_at
         FROM tenant_integration_policies
        WHERE tenant_id = ? AND app_key IN (${inClause}) AND status = 'active'
        ORDER BY app_key ASC`,
      [tenantId, ...appKeys]
    );
  }

  if (appKeys.length && (tenantId || userId)) {
    const inClause = placeholders(appKeys);
    const filters = [`app_key IN (${inClause})`];
    const params = [...appKeys];
    if (tenantId) { filters.push("tenant_id = ?"); params.push(tenantId); }
    if (userId) { filters.push("user_id = ?"); params.push(userId); }
    userConnectionRows = await safeQuery(
      pool,
      `SELECT tenant_id, ${userId ? "user_id" : "NULL AS user_id"}, app_key, auth_type, status,
              validation_status, COUNT(*) AS connection_count,
              MAX(last_validated_at) AS last_validated_at, MAX(last_used_at) AS last_used_at
         FROM user_app_connections
        WHERE ${filters.join(" AND ")}
        GROUP BY tenant_id, ${userId ? "user_id," : ""} app_key, auth_type, status, validation_status
        ORDER BY app_key ASC, status ASC`,
      params
    );
  }

  const actionByKey = indexByAppKey(actionRows);
  const toolByKey = indexByAppKey(toolRows);
  const policyByKey = indexByAppKey(tenantPolicyRows);
  const connectionByKey = indexByAppKey(userConnectionRows);

  const plugins = appRows.map((row) => normalizePlatformPlugin(row, {
    actionBindings: actionByKey.get(row.app_key) || [],
    toolBindings: toolByKey.get(row.app_key) || [],
    tenantPolicies: policyByKey.get(row.app_key) || [],
    userConnectionSummary: connectionByKey.get(row.app_key) || [],
  }));

  const protocolCounts = {};
  const credentialScopeCounts = {};
  for (const plugin of plugins) {
    for (const protocol of plugin.protocols) protocolCounts[protocol] = (protocolCounts[protocol] || 0) + 1;
    for (const scope of plugin.credential_resolver_policy.supported_scopes) {
      credentialScopeCounts[scope] = (credentialScopeCounts[scope] || 0) + 1;
    }
  }

  return {
    ok: true,
    terminology: {
      canonical_name: "Platform Plugin",
      definition: "Governed extension unit backed by protocol bindings, action/tool bindings, credential resolver policy, tenant/user overlays, runtime validation, and audit evidence.",
      current_storage_model: "app_integrations + app_integration_*_bindings + tenant_integration_policies + user_app_connections",
    },
    filters: {
      tenant_id: tenantId || null,
      user_id: userId || null,
      include_inactive: Boolean(includeInactive),
      include_bindings: Boolean(includeBindings),
      limit: boundedLimit,
    },
    totals: {
      plugins: plugins.length,
      action_bindings: actionRows.length,
      tool_bindings: toolRows.length,
      tenant_policy_rows: tenantPolicyRows.length,
      user_connection_groups: userConnectionRows.length,
      protocols: protocolCounts,
      credential_scopes: credentialScopeCounts,
    },
    plugins,
    secrets_included: false,
  };
}
