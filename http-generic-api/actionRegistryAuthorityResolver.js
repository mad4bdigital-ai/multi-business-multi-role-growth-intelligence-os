import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

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

function tokenSet(value = "") {
  return new Set(splitTokens(value).map(normalize));
}

function fieldAllows(value, requested = null, { emptyAllows = true } = {}) {
  const tokens = tokenSet(value);
  if (!tokens.size) return emptyAllows;
  if (tokens.has("*") || tokens.has("all") || tokens.has("any")) return true;
  const req = normalize(requested || "");
  if (!req) return emptyAllows;
  return tokens.has(req);
}

function actionActive(row = {}) {
  if (isDisabled(row.status)) return false;
  if (row.status) return ["active", "ready", "beta", "enabled"].includes(normalize(row.status));
  return true;
}

function runtimeCallable(row = {}) {
  if (row.runtime_callable === null || row.runtime_callable === undefined || row.runtime_callable === "") return true;
  return isTruthy(row.runtime_callable);
}

function actionScore(row = {}, input = {}, evaluation = {}) {
  let score = 0;
  if (input.action_key && normalize(row.action_key) === normalize(input.action_key)) score += 180;
  if (input.plugin_key && normalize(row.plugin_app_key) === normalize(input.plugin_key)) score += 90;
  if (input.connector_family && normalize(row.connector_family) === normalize(input.connector_family)) score += 45;
  if (input.module_binding && normalize(row.module_binding) === normalize(input.module_binding)) score += 40;
  if (input.runtime_capability_class && normalize(row.runtime_capability_class) === normalize(input.runtime_capability_class)) score += 35;
  if (input.endpoint_group && normalize(row.endpoint_group) === normalize(input.endpoint_group)) score += 30;
  if (row.plugin_binding_status && normalize(row.plugin_binding_status) === "active") score += 20;
  if (row.plugin_status && ["active", "beta"].includes(normalize(row.plugin_status))) score += 15;
  if (evaluation.allowed) score += 20;
  return score;
}

function deriveCustomizationLayers(row = {}, input = {}) {
  const layers = ["platform_base"];
  if (row.plugin_app_key) layers.push("plugin_container_specialization");
  if (row.plugin_binding_id) layers.push("plugin_action_binding_specialization");
  if (row.connector_family || row.module_binding || row.endpoint_group || row.runtime_binding_profile) layers.push("protocol_binding_specialization");
  if (row.runtime_capability_class || row.primary_executor || row.execution_layer) layers.push("runtime_capability_specialization");
  if (row.plugin_auth_type || row.oauth_binding_status || row.api_key_mode) layers.push("auth_policy_specialization");
  if (row.openai_schema_ref || row.openai_schema_file_name || row.structured_api_supported || row.request_envelope_required) layers.push("schema_contract_specialization");
  if (input.tenant_id || input.client_key) layers.push("client_context_available");
  if (input.team_key) layers.push("team_context_available");
  if (input.user_id) layers.push("user_context_available");
  if (row.allowed_actor_roles || row.allowed_governance_levels || row.review_required) layers.push("governance_requirement_specialization");
  return [...new Set(layers)];
}

function evaluateAction(row = {}, input = {}) {
  const reasons = [];
  const matches = [];

  if (!actionActive(row)) reasons.push("action_not_active");
  if (!runtimeCallable(row)) reasons.push("action_not_runtime_callable");

  const adminRequested = input.is_admin === true || normalize(input.actor_role) === "admin";
  if (isTruthy(row.admin_only) && !adminRequested) reasons.push("admin_only_action");

  if (input.action_key) {
    if (normalize(row.action_key) === normalize(input.action_key)) {
      matches.push({ field: "action_key", type: "exact", value: compact(row.action_key, 160) });
    } else {
      reasons.push("action_key_not_matched");
    }
  }

  if (input.plugin_key) {
    if (normalize(row.plugin_app_key) === normalize(input.plugin_key)) {
      matches.push({ field: "plugin_key", type: "exact", value: compact(row.plugin_app_key, 160) });
    } else {
      reasons.push("plugin_key_not_matched");
    }
  }

  for (const [inputField, rowField, reason] of [
    ["connector_family", "connector_family", "connector_family_not_matched"],
    ["module_binding", "module_binding", "module_binding_not_matched"],
    ["runtime_capability_class", "runtime_capability_class", "runtime_capability_class_not_matched"],
    ["endpoint_group", "endpoint_group", "endpoint_group_not_matched"],
  ]) {
    if (input[inputField] && row[rowField] && normalize(input[inputField]) !== normalize(row[rowField])) reasons.push(reason);
    else if (input[inputField] && row[rowField]) matches.push({ field: rowField, type: "exact", value: compact(row[rowField], 160) });
  }

  if (row.plugin_binding_status && normalize(row.plugin_binding_status) !== "active") reasons.push("plugin_action_binding_not_active");
  if (row.plugin_status && !["active", "beta"].includes(normalize(row.plugin_status))) reasons.push("plugin_not_active");

  if (!fieldAllows(row.allowed_actor_roles, input.actor_role, { emptyAllows: true })) reasons.push("actor_role_not_allowed");
  if (!fieldAllows(row.allowed_governance_levels, input.governance_level, { emptyAllows: true })) reasons.push("governance_level_not_allowed");
  if (!fieldAllows(row.client_allowed, input.client_key || input.tenant_id, { emptyAllows: true })) reasons.push("client_not_allowed");
  if (!fieldAllows(row.team_allowed, input.team_key, { emptyAllows: true })) reasons.push("team_not_allowed");

  const allowed = reasons.length === 0;
  const evaluation = {
    allowed,
    reasons,
    matches,
    customization_layers: deriveCustomizationLayers(row, input),
  };
  evaluation.score = actionScore(row, input, evaluation);
  if (!allowed) evaluation.score -= 200;
  return evaluation;
}

function sanitizeAction(row = {}, evaluation = {}) {
  const plugin = row.plugin_app_key ? {
    plugin_key: row.plugin_app_key,
    display_name: row.plugin_display_name || null,
    auth_type: row.plugin_auth_type || null,
    category: row.plugin_category || null,
    status: row.plugin_status || null,
    binding: {
      binding_id: row.plugin_binding_id || null,
      binding_role: row.plugin_binding_role || null,
      credential_source: row.plugin_credential_source || null,
      exposure_default: row.plugin_exposure_default || null,
      status: row.plugin_binding_status || null,
    },
    tenant_policy: row.policy_tenant_id ? {
      tenant_id: row.policy_tenant_id,
      source_mode: row.policy_source_mode || null,
      fallback_allowed: row.policy_fallback_allowed === null || row.policy_fallback_allowed === undefined ? null : Boolean(row.policy_fallback_allowed),
      status: row.policy_status || null,
    } : null,
    connection_summary: {
      active_connection_count: Number(row.active_connection_count || 0),
      primary_connection_available: Number(row.primary_connection_count || 0) > 0,
    },
  } : null;

  return {
    action_key: row.action_key || null,
    action_id: row.action_id || null,
    action_title: row.action_title || null,
    action_class: row.action_class || null,
    action_scope: row.action_scope || null,
    status: row.status || null,
    runtime_callable: runtimeCallable(row),
    runtime: {
      connector_family: row.connector_family || null,
      module_binding: row.module_binding || null,
      runtime_capability_class: row.runtime_capability_class || null,
      runtime_binding_profile: row.runtime_binding_profile || null,
      primary_executor: row.primary_executor || null,
      execution_layer: row.execution_layer || null,
      route_target: row.route_target || null,
      endpoint_group: row.endpoint_group || null,
      provider_agnostic: isTruthy(row.provider_agnostic),
      structured_api_supported: isTruthy(row.structured_api_supported),
      conversational_trigger_supported: isTruthy(row.conversational_trigger_supported),
      request_envelope_required: isTruthy(row.request_envelope_required),
    },
    governance: {
      review_required: isTruthy(row.review_required),
      admin_only: isTruthy(row.admin_only),
      allowed_actor_roles: splitTokens(row.allowed_actor_roles),
      allowed_governance_levels: splitTokens(row.allowed_governance_levels),
      client_allowed: splitTokens(row.client_allowed),
      team_allowed: splitTokens(row.team_allowed),
      writeback_scope: row.writeback_scope || null,
      logging_target: row.logging_target || null,
    },
    schema_contract: {
      openai_action_binding: row.openai_action_binding || null,
      openai_schema_ref: row.openai_schema_ref || null,
      openai_schema_file_name: row.openai_schema_file_name || null,
      openai_schema_storage_surface: row.openai_schema_storage_surface || null,
      oauth_config_ref: row.oauth_config_ref || null,
      oauth_binding_status: row.oauth_binding_status || null,
      required_variable_contracts: row.required_variable_contracts || null,
    },
    plugin,
    customization: {
      layers: evaluation.customization_layers || [],
      base_action: (evaluation.customization_layers || []).includes("platform_base"),
      specialized: (evaluation.customization_layers || []).some((layer) => layer !== "platform_base"),
      override_model: "actions_registry_with_platform_plugin_taxonomy",
    },
    evaluation: {
      allowed: evaluation.allowed === true,
      score: evaluation.score || 0,
      reasons: evaluation.reasons || [],
      matches: evaluation.matches || [],
    },
    secrets_included: false,
  };
}

export async function resolveActionCandidates({
  pool = getPool(),
  action_key = null,
  plugin_key = null,
  connector_family = null,
  module_binding = null,
  runtime_capability_class = null,
  endpoint_group = null,
  tenant_id = null,
  user_id = null,
  actor_role = null,
  governance_level = null,
  client_key = null,
  team_key = null,
  is_admin = false,
  include_denied = false,
  limit = 10,
} = {}) {
  const surfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.ACTION_REGISTRY,
    { requireExecution: true },
    { pool }
  );

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const where = ["1 = 1"];
  const params = [
    tenant_id || null,
    tenant_id || null,
    tenant_id || null,
    user_id || null,
    user_id || null,
  ];

  if (action_key) {
    where.push("a.action_key = ?");
    params.push(action_key);
  }
  if (plugin_key) {
    where.push("b.app_key = ?");
    params.push(plugin_key);
  }
  if (connector_family) {
    where.push("(a.connector_family IS NULL OR a.connector_family = '' OR a.connector_family = ?)");
    params.push(connector_family);
  }
  if (module_binding) {
    where.push("(a.module_binding IS NULL OR a.module_binding = '' OR a.module_binding = ?)");
    params.push(module_binding);
  }
  if (runtime_capability_class) {
    where.push("(a.runtime_capability_class IS NULL OR a.runtime_capability_class = '' OR a.runtime_capability_class = ?)");
    params.push(runtime_capability_class);
  }
  if (endpoint_group) {
    where.push("(a.endpoint_group IS NULL OR a.endpoint_group = '' OR a.endpoint_group = ?)");
    params.push(endpoint_group);
  }

  const [rows] = await pool.query(
    `SELECT a.action_key, a.status, a.module_binding, a.connector_family,
            a.runtime_capability_class, a.runtime_callable, a.primary_executor,
            a.action_id, a.action_title, a.action_class, a.action_scope,
            a.trigger_phrase, a.route_target, a.execution_layer,
            a.dependencies, a.logging_target, a.inventory_role,
            a.openai_action_binding, a.endpoint_group, a.review_required,
            a.openai_schema_ref, a.oauth_config_ref, a.oauth_binding_status,
            a.openai_schema_file_name, a.openai_schema_storage_surface,
            a.required_variable_contracts, a.runtime_binding_profile,
            a.client_interface_agnostic, a.request_envelope_required,
            a.structured_api_supported, a.conversational_trigger_supported,
            a.provider_agnostic, a.allowed_actor_roles,
            a.allowed_governance_levels, a.client_allowed, a.team_allowed,
            a.admin_only, a.writeback_scope,
            b.binding_id AS plugin_binding_id,
            b.app_key AS plugin_app_key,
            b.binding_role AS plugin_binding_role,
            b.credential_source AS plugin_credential_source,
            b.exposure_default AS plugin_exposure_default,
            b.status AS plugin_binding_status,
            i.display_name AS plugin_display_name,
            i.auth_type AS plugin_auth_type,
            i.category AS plugin_category,
            i.status AS plugin_status,
            p.tenant_id AS policy_tenant_id,
            p.source_mode AS policy_source_mode,
            p.fallback_allowed AS policy_fallback_allowed,
            p.status AS policy_status,
            COALESCE(c.active_connection_count, 0) AS active_connection_count,
            COALESCE(c.primary_connection_count, 0) AS primary_connection_count
       FROM \`actions\` a
       LEFT JOIN app_integration_action_bindings b ON b.action_key = a.action_key
       LEFT JOIN app_integrations i ON i.app_key = b.app_key
       LEFT JOIN tenant_integration_policies p
              ON p.app_key = b.app_key
             AND p.tenant_id = ?
             AND p.status = 'active'
       LEFT JOIN (
            SELECT app_key,
                   COUNT(*) AS active_connection_count,
                   SUM(CASE WHEN is_primary = 1 THEN 1 ELSE 0 END) AS primary_connection_count
              FROM user_app_connections
             WHERE status = 'active'
               AND (? IS NULL OR tenant_id = ?)
               AND (? IS NULL OR user_id = ?)
             GROUP BY app_key
       ) c ON c.app_key = b.app_key
      WHERE ${where.join(" AND ")}
      ORDER BY a.action_key ASC, b.app_key ASC
      LIMIT 300`,
    params
  );

  const input = {
    action_key,
    plugin_key,
    connector_family,
    module_binding,
    runtime_capability_class,
    endpoint_group,
    tenant_id,
    user_id,
    actor_role,
    governance_level,
    client_key,
    team_key,
    is_admin,
  };

  const candidates = (rows || [])
    .map((row) => sanitizeAction(row, evaluateAction(row, input)))
    .filter((candidate) => include_denied || candidate.evaluation.allowed)
    .sort((a, b) => (b.evaluation.score || 0) - (a.evaluation.score || 0))
    .slice(0, safeLimit);

  return {
    ok: true,
    resolver: "shared_action_registry_authority_resolver",
    mode: "read_model_only",
    requested: {
      action_key: action_key || null,
      plugin_key: plugin_key || null,
      connector_family: connector_family || null,
      module_binding: module_binding || null,
      runtime_capability_class: runtime_capability_class || null,
      endpoint_group: endpoint_group || null,
      tenant_id: tenant_id || null,
      user_id: user_id || null,
      actor_role: actor_role || null,
      governance_level: governance_level || null,
      client_key: client_key || null,
      team_key: team_key || null,
      include_denied: include_denied === true,
    },
    count: candidates.length,
    candidates,
    taxonomy_model: {
      action_authority_layer: "actions",
      plugin_container_layer: "app_integrations",
      plugin_binding_layer: "app_integration_action_bindings",
      tenant_policy_layer: "tenant_integration_policies",
      user_connection_layer: "user_app_connections",
      approval_layer: "app_action_grants",
      future_override_layers: [
        "tenant_action_overrides",
        "agent_skill_grants",
        "workspace_app_links",
        "platform_plugin_contributions",
      ],
      secrets_included: false,
    },
    surface_authority: {
      ok: surfaceAuthority.ok,
      resolved_surface_key: surfaceAuthority.resolved_surface_key,
      classification: surfaceAuthority.classification,
      code: surfaceAuthority.code,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
