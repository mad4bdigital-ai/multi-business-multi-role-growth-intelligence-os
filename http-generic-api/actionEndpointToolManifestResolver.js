import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";
import { resolveActionCandidates } from "./actionRegistryAuthorityResolver.js";

function compact(value = "", max = 800) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["true", "1", "yes", "y", "active", "enabled", "allow", "allowed"].includes(normalize(value));
}

function isDisabled(value) {
  return ["false", "0", "no", "n", "inactive", "disabled", "blocked", "archived", "retired", "deprecated"].includes(normalize(value));
}

function splitTokens(value = "") {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function endpointActive(row = {}) {
  if (isDisabled(row.status) || isDisabled(row.execution_readiness)) return false;
  if (row.status) return ["active", "ready", "enabled"].includes(normalize(row.status));
  return true;
}

function toolActive(row = {}) {
  if (row.tool_is_enabled === 0 || row.tool_is_enabled === false) return false;
  if (row.binding_status && normalize(row.binding_status) !== "active") return false;
  return true;
}

function sanitizeEndpoint(row = {}) {
  return {
    endpoint_id: row.endpoint_id || null,
    parent_action_key: row.parent_action_key || null,
    endpoint_key: row.endpoint_key || null,
    endpoint_title: row.endpoint_title || null,
    endpoint_operation: row.endpoint_operation || null,
    endpoint_role: row.endpoint_role || null,
    method: row.method || null,
    provider_domain: row.provider_domain || null,
    provider_family: row.provider_family || null,
    endpoint_path_or_function: compact(row.endpoint_path_or_function, 1200) || null,
    route_target: row.route_target || null,
    openai_action_name: row.openai_action_name || null,
    module_binding: row.module_binding || null,
    connector_family: row.connector_family || null,
    status: row.status || null,
    readiness: {
      active: endpointActive(row),
      spec_validation_status: row.spec_validation_status || null,
      auth_validation_status: row.auth_validation_status || null,
      privacy_validation_status: row.privacy_validation_status || null,
      execution_readiness: row.execution_readiness || null,
      transport_required: isTruthy(row.transport_required),
      fallback_allowed: isTruthy(row.fallback_allowed),
    },
    schema_contract: {
      schema_json_present: Boolean(row.schema_json_present),
      child_openai_schema_file_id_present: Boolean(row.child_openai_schema_file_id_present),
      schema_overlay_mode: row.schema_overlay_mode || null,
      schema_overlay_status: row.schema_overlay_status || null,
      schema_overlay_parent_action_key: row.schema_overlay_parent_action_key || null,
      required_variable_contracts: row.required_variable_contracts || null,
      runtime_binding_profile: row.runtime_binding_profile || null,
    },
    governance: {
      review_required: isTruthy(row.review_required),
      admin_only: isTruthy(row.admin_only),
      allowed_actor_roles: splitTokens(row.allowed_actor_roles),
      allowed_governance_levels: splitTokens(row.allowed_governance_levels),
      client_allowed: splitTokens(row.client_allowed),
      team_allowed: splitTokens(row.team_allowed),
      writeback_scope: row.writeback_scope || null,
    },
    secrets_included: false,
  };
}

function sanitizeTool(row = {}) {
  return {
    tool_key: row.tool_key || null,
    tool_surface: row.tool_surface || null,
    display_name: row.display_name || null,
    description: compact(row.description, 1200) || null,
    http_method: row.http_method || null,
    http_path: row.http_path || null,
    path_param_keys: row.path_param_keys || null,
    tags: splitTokens(row.tags),
    is_enabled: Boolean(row.tool_is_enabled),
    schema_contract: {
      input_schema_present: Boolean(row.input_schema_present),
      fixed_body_present: Boolean(row.fixed_body_present),
    },
    binding: {
      binding_id: row.binding_id || null,
      app_key: row.app_key || null,
      binding_role: row.binding_role || null,
      credential_source: row.credential_source || null,
      exposure_scope: row.exposure_scope || null,
      status: row.binding_status || null,
      active: toolActive(row),
    },
    secrets_included: false,
  };
}

async function loadEndpoints(pool, { actionKey, endpointKey, includeDisabled, limit }) {
  if (!actionKey && !endpointKey) return [];
  const where = ["1 = 1"];
  const params = [];
  if (actionKey) {
    where.push("parent_action_key = ?");
    params.push(actionKey);
  }
  if (endpointKey) {
    where.push("endpoint_key = ?");
    params.push(endpointKey);
  }
  if (!includeDisabled) {
    where.push("(status IS NULL OR status NOT IN ('deprecated','archived','disabled','inactive'))");
  }
  const [rows] = await pool.query(
    `SELECT endpoint_id, parent_action_key, endpoint_key, endpoint_title,
            endpoint_operation, endpoint_role, method, provider_domain,
            provider_family, endpoint_path_or_function, route_target,
            openai_action_name, module_binding, connector_family, status,
            spec_validation_status, auth_validation_status,
            privacy_validation_status, execution_readiness,
            transport_required, fallback_allowed, schema_json IS NOT NULL AS schema_json_present,
            child_openai_schema_file_id IS NOT NULL AS child_openai_schema_file_id_present,
            schema_overlay_mode, schema_overlay_status,
            schema_overlay_parent_action_key, required_variable_contracts,
            runtime_binding_profile, review_required, admin_only,
            allowed_actor_roles, allowed_governance_levels, client_allowed,
            team_allowed, writeback_scope
       FROM endpoints
      WHERE ${where.join(" AND ")}
      ORDER BY parent_action_key ASC, endpoint_key ASC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(Number(limit) || 50, 100))]
  );
  return (rows || []).map(sanitizeEndpoint);
}

async function loadTools(pool, { pluginKeys, toolKey, includeDisabled, limit }) {
  const where = ["1 = 1"];
  const params = [];
  if (pluginKeys.length) {
    where.push(`b.app_key IN (${pluginKeys.map(() => "?").join(",")})`);
    params.push(...pluginKeys);
  }
  if (toolKey) {
    where.push("b.tool_key = ?");
    params.push(toolKey);
  }
  if (!includeDisabled) {
    where.push("b.status = 'active'");
  }
  const [rows] = await pool.query(
    `SELECT b.binding_id, b.app_key, b.tool_key, b.tool_surface,
            b.binding_role, b.credential_source, b.exposure_scope,
            b.status AS binding_status,
            t.display_name, t.description, t.http_method, t.http_path,
            t.path_param_keys, t.input_schema IS NOT NULL AS input_schema_present,
            t.fixed_body IS NOT NULL AS fixed_body_present,
            t.tags, t.is_enabled AS tool_is_enabled
       FROM app_integration_tool_bindings b
       LEFT JOIN admin_platform_endpoint_tools t ON t.tool_key = b.tool_key
      WHERE ${where.join(" AND ")}
      ORDER BY b.app_key ASC, b.tool_key ASC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(Number(limit) || 50, 100))]
  );
  return (rows || []).map(sanitizeTool);
}

function derivePluginKeys(actionResult, explicitPluginKey = null) {
  const fromActions = (actionResult?.candidates || [])
    .map((candidate) => candidate.plugin?.plugin_key)
    .filter(Boolean);
  return unique([explicitPluginKey, ...fromActions]);
}

export async function resolveActionEndpointToolManifest({
  pool = getPool(),
  action_key = null,
  endpoint_key = null,
  plugin_key = null,
  tool_key = null,
  tenant_id = null,
  user_id = null,
  actor_role = null,
  governance_level = null,
  client_key = null,
  team_key = null,
  is_admin = false,
  include_denied = false,
  include_disabled = false,
  limit = 20,
} = {}) {
  const endpointSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.ENDPOINT_REGISTRY,
    { requireExecution: true },
    { pool }
  );
  const toolSurfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.TOOL_MANIFEST,
    { requireExecution: true },
    { pool }
  );

  const actionResult = await resolveActionCandidates({
    pool,
    action_key,
    plugin_key,
    tenant_id,
    user_id,
    actor_role,
    governance_level,
    client_key,
    team_key,
    is_admin,
    include_denied,
    limit,
  });
  const pluginKeys = derivePluginKeys(actionResult, plugin_key);
  const requestedActionKeys = unique([
    action_key,
    ...(actionResult.candidates || []).map((candidate) => candidate.action_key),
  ]);
  const endpointRows = [];
  for (const key of requestedActionKeys.length ? requestedActionKeys : [null]) {
    endpointRows.push(...await loadEndpoints(pool, {
      actionKey: key,
      endpointKey: endpoint_key,
      includeDisabled: include_disabled,
      limit,
    }));
  }
  const toolRows = await loadTools(pool, {
    pluginKeys,
    toolKey: tool_key,
    includeDisabled: include_disabled,
    limit,
  });

  const endpointByAction = new Map();
  for (const endpoint of endpointRows) {
    const key = endpoint.parent_action_key || "__unbound__";
    if (!endpointByAction.has(key)) endpointByAction.set(key, []);
    endpointByAction.get(key).push(endpoint);
  }
  const toolsByPlugin = new Map();
  for (const tool of toolRows) {
    const key = tool.binding.app_key || "__unbound__";
    if (!toolsByPlugin.has(key)) toolsByPlugin.set(key, []);
    toolsByPlugin.get(key).push(tool);
  }

  const manifests = (actionResult.candidates || []).map((action) => ({
    action,
    endpoints: endpointByAction.get(action.action_key) || [],
    tools: action.plugin?.plugin_key ? (toolsByPlugin.get(action.plugin.plugin_key) || []) : [],
    readiness: {
      action_allowed: action.evaluation.allowed,
      endpoint_count: (endpointByAction.get(action.action_key) || []).length,
      tool_count: action.plugin?.plugin_key ? (toolsByPlugin.get(action.plugin.plugin_key) || []).length : 0,
      manifest_complete: action.evaluation.allowed && (endpointByAction.get(action.action_key) || []).length > 0,
    },
    secrets_included: false,
  }));

  if (!manifests.length && (tool_key || plugin_key)) {
    manifests.push({
      action: null,
      endpoints: endpointRows,
      tools: toolRows,
      readiness: {
        action_allowed: false,
        endpoint_count: endpointRows.length,
        tool_count: toolRows.length,
        manifest_complete: false,
      },
      secrets_included: false,
    });
  }

  return {
    ok: true,
    resolver: "shared_action_endpoint_tool_manifest_resolver",
    mode: "read_model_only",
    requested: {
      action_key: action_key || null,
      endpoint_key: endpoint_key || null,
      plugin_key: plugin_key || null,
      tool_key: tool_key || null,
      tenant_id: tenant_id || null,
      user_id: user_id || null,
      actor_role: actor_role || null,
      governance_level: governance_level || null,
      include_denied: include_denied === true,
      include_disabled: include_disabled === true,
    },
    count: manifests.length,
    manifests,
    surface_authority: {
      action_registry: actionResult.surface_authority,
      endpoint_registry: {
        ok: endpointSurfaceAuthority.ok,
        resolved_surface_key: endpointSurfaceAuthority.resolved_surface_key,
        classification: endpointSurfaceAuthority.classification,
        code: endpointSurfaceAuthority.code,
        secrets_included: false,
      },
      tool_manifest: {
        ok: toolSurfaceAuthority.ok,
        resolved_surface_key: toolSurfaceAuthority.resolved_surface_key,
        classification: toolSurfaceAuthority.classification,
        code: toolSurfaceAuthority.code,
        secrets_included: false,
      },
    },
    authority_chain: [
      "task_route_authority_resolver",
      "workflow_registry_authority_resolver",
      "action_registry_authority_resolver",
      "endpoint_registry",
      "platform_tool_manifest",
    ],
    secrets_included: false,
  };
}
