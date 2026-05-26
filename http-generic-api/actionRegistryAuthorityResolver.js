import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function compact(value = "", max = 800) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["true", "1", "yes", "y", "active", "enabled", "allow", "allowed", "ready", "beta"].includes(normalize(value));
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

function textMatches(value = "", requested = null) {
  const req = normalize(requested || "");
  if (!req) return { matched: true, score: 0, reason: "not_requested" };
  const tokens = splitTokens(value);
  if (!tokens.length) return { matched: true, score: 0, reason: "no_constraint" };
  for (const token of tokens) {
    const n = normalize(token);
    if (["*", "all", "any"].includes(n)) return { matched: true, score: 1, reason: "wildcard" };
    if (n === req) return { matched: true, score: 35, reason: "exact" };
    if (req.includes(n) || n.includes(req)) return { matched: true, score: 12, reason: "partial" };
  }
  return { matched: false, score: -50, reason: "not_matched" };
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function actionActive(row = {}) {
  if (isDisabled(row.status)) return false;
  if (row.status) return isTruthy(row.status);
  return true;
}

function runtimeCallable(row = {}) {
  if (row.runtime_callable === undefined || row.runtime_callable === null || row.runtime_callable === "") return false;
  return isTruthy(row.runtime_callable);
}

function deriveProtocolHints(row = {}) {
  const profile = parseJsonObject(row.runtime_binding_profile);
  const hints = new Set();
  const text = normalize([
    row.action_key,
    row.connector_family,
    row.module_binding,
    row.endpoint_group,
    row.runtime_capability_class,
    row.primary_executor,
    row.action_class,
    row.action_scope,
    profile.protocol,
    profile.transport_protocol,
    profile.transport_surface,
  ].filter(Boolean).join("|"));

  if (text.includes("mcp")) hints.add("mcp");
  if (text.includes("webhook")) hints.add("webhook");
  if (text.includes("browser") || text.includes("playwright") || text.includes("puppeteer")) hints.add("browser_automation");
  if (text.includes("local") || text.includes("device") || text.includes("connector")) hints.add("local_connector");
  if (text.includes("oauth")) hints.add("oauth_app");
  if (
    text.includes("api") ||
    text.includes("http") ||
    text.includes("rest") ||
    text.includes("googleapis") ||
    text.includes("github") ||
    text.includes("hostinger") ||
    text.includes("cloudflare") ||
    text.includes("serp") ||
    text.includes("scrape")
  ) hints.add("rest_api");

  const authMode = normalize(row.api_key_mode || profile.auth_strategy || profile.auth_mode);
  if (authMode.includes("oauth")) hints.add("oauth2_auth");
  if (authMode.includes("api") || authMode.includes("key")) hints.add("api_key_auth");
  if (authMode.includes("bearer")) hints.add("bearer_auth");
  if (authMode.includes("delegated") || authMode.includes("connection")) hints.add("delegated_connection_auth");

  return [...hints];
}

function protocolAllows(row = {}, requestedProtocol = null) {
  const requested = normalize(requestedProtocol || "");
  if (!requested) return { allowed: true, score: 0, reason: "not_requested" };
  const hints = deriveProtocolHints(row).map(normalize);
  if (!hints.length) return { allowed: true, score: 0, reason: "no_protocol_hint" };
  if (hints.includes(requested)) return { allowed: true, score: 25, reason: "exact_protocol_hint" };
  if (hints.some((hint) => hint.includes(requested) || requested.includes(hint))) {
    return { allowed: true, score: 12, reason: "partial_protocol_hint" };
  }
  return { allowed: false, score: -50, reason: "protocol_not_allowed" };
}

function credentialScopeAllows(row = {}, requestedCredentialScope = null) {
  const requested = normalize(requestedCredentialScope || "");
  if (!requested) return { allowed: true, score: 0, reason: "not_requested" };
  const profile = parseJsonObject(row.runtime_binding_profile);
  const possible = [
    profile.credential_scope,
    profile.requested_credential_scope,
    profile.runtime_credential_scope,
    profile.auth_scope,
    row.api_key_mode,
    row.api_key_storage_mode,
  ].filter(Boolean).join("|");
  const match = textMatches(possible, requested);
  if (match.matched) return { allowed: true, score: match.score, reason: match.reason };
  if (!possible) return { allowed: true, score: 0, reason: "no_credential_scope_constraint" };
  return { allowed: false, score: -50, reason: "credential_scope_not_allowed" };
}

function deriveCustomizationLayers(row = {}, input = {}) {
  const layers = ["platform_base"];
  if (row.connector_family || row.module_binding || row.endpoint_group || row.openai_action_binding) layers.push("plugin_container_specialization");
  if (deriveProtocolHints(row).length || row.runtime_binding_profile) layers.push("protocol_binding_specialization");
  if (row.runtime_capability_class || row.primary_executor || row.runtime_callable) layers.push("runtime_capability_specialization");
  if (row.api_key_mode || row.api_key_storage_mode || row.oauth_binding_status || row.has_secret_ref) layers.push("auth_policy_specialization");
  if (row.has_openai_schema_file || row.has_schema_json || row.has_openai_schema_ref) layers.push("schema_contract_specialization");
  if (input.tenant_id || input.tenantId || input.client_key || input.clientKey) {
    const clientField = normalize(row.client_allowed);
    if (clientField && !["all", "any", "*"].includes(clientField)) layers.push("client_specialization");
  }
  if (input.team_key || input.teamKey) {
    const teamField = normalize(row.team_allowed);
    if (teamField && !["all", "any", "*"].includes(teamField)) layers.push("team_specialization");
  }
  if (input.user_id || input.userId) layers.push("user_context_available");
  if (row.allowed_actor_roles || row.allowed_governance_levels || row.admin_only) layers.push("actor_governance_specialization");
  if (row.writeback_scope || row.review_required) layers.push("governance_requirement_specialization");
  return [...new Set(layers)];
}

function evaluateAction(row = {}, input = {}) {
  const reasons = [];
  const matches = [];
  let score = 0;

  if (!actionActive(row)) {
    return { allowed: false, score: -1000, reasons: ["action_inactive"], matches, customization_layers: [] };
  }

  if (input.require_runtime_callable !== false && !runtimeCallable(row)) reasons.push("action_not_runtime_callable");

  const adminRequested = input.is_admin === true || normalize(input.actor_role || input.actorRole) === "admin";
  if (isTruthy(row.admin_only) && !adminRequested) reasons.push("admin_only_action");

  const actionKey = input.action_key || input.actionKey;
  if (actionKey) {
    if (normalize(row.action_key) === normalize(actionKey) || normalize(row.action_id) === normalize(actionKey)) {
      score += 170;
      matches.push({ field: row.action_key ? "action_key" : "action_id", type: "exact", value: compact(row.action_key || row.action_id, 160) });
    } else {
      reasons.push("action_key_not_matched");
    }
  }

  const routeTarget = input.route_target || input.routeTarget;
  if (routeTarget) {
    const match = textMatches(row.route_target || row.action_key, routeTarget);
    if (match.matched) {
      score += match.score + 35;
      matches.push({ field: "route_target", type: match.reason, value: compact(row.route_target || row.action_key, 160) });
    } else reasons.push("route_target_not_matched");
  }

  for (const [inputKey, rowKey, reason, fieldName] of [
    ["connector_family", "connector_family", "connector_family_not_matched", "connector_family"],
    ["module_binding", "module_binding", "module_binding_not_matched", "module_binding"],
    ["endpoint_group", "endpoint_group", "endpoint_group_not_matched", "endpoint_group"],
    ["runtime_capability_class", "runtime_capability_class", "runtime_capability_class_not_matched", "runtime_capability_class"],
    ["primary_executor", "primary_executor", "primary_executor_not_matched", "primary_executor"],
    ["action_class", "action_class", "action_class_not_matched", "action_class"],
    ["action_scope", "action_scope", "action_scope_not_matched", "action_scope"],
    ["execution_layer", "execution_layer", "execution_layer_not_matched", "execution_layer"],
  ]) {
    const requested = input[inputKey];
    if (!requested) continue;
    const match = textMatches(row[rowKey], requested);
    if (match.matched) {
      score += match.score + 10;
      matches.push({ field: fieldName, type: match.reason, value: compact(row[rowKey], 160) });
    } else {
      reasons.push(reason);
    }
  }

  const actorRole = input.actor_role || input.actorRole;
  if (!fieldAllows(row.allowed_actor_roles, actorRole, { emptyAllows: true })) reasons.push("actor_role_not_allowed");
  else if (actorRole && row.allowed_actor_roles) score += 20;

  const governance = input.governance_level || input.governanceLevel;
  if (!fieldAllows(row.allowed_governance_levels, governance, { emptyAllows: true })) reasons.push("governance_level_not_allowed");
  else if (governance && row.allowed_governance_levels) score += 20;

  const clientKey = input.client_key || input.clientKey || input.tenant_id || input.tenantId;
  if (!fieldAllows(row.client_allowed, clientKey, { emptyAllows: true })) reasons.push("client_not_allowed");
  else if (clientKey && row.client_allowed) score += 30;

  const teamKey = input.team_key || input.teamKey;
  if (!fieldAllows(row.team_allowed, teamKey, { emptyAllows: true })) reasons.push("team_not_allowed");
  else if (teamKey && row.team_allowed) score += 20;

  const protocol = protocolAllows(row, input.requested_protocol || input.protocol);
  if (!protocol.allowed) reasons.push(protocol.reason);
  else score += protocol.score;

  const credentialScope = credentialScopeAllows(row, input.requested_credential_scope || input.credential_scope);
  if (!credentialScope.allowed) reasons.push(credentialScope.reason);
  else score += credentialScope.score;

  if (input.requires_schema_contract === true && !(row.has_openai_schema_file || row.has_schema_json || row.has_openai_schema_ref)) {
    reasons.push("schema_contract_missing");
  } else if (row.has_openai_schema_file || row.has_schema_json || row.has_openai_schema_ref) {
    score += 8;
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    score: allowed ? score : score - 200,
    reasons,
    matches,
    customization_layers: deriveCustomizationLayers(row, input),
  };
}

function sanitizeAction(row = {}, evaluation = {}) {
  const protocolHints = deriveProtocolHints(row);
  return {
    action_id: row.action_id || null,
    action_key: row.action_key || null,
    action_title: compact(row.action_title, 500) || null,
    action_class: row.action_class || null,
    action_scope: row.action_scope || null,
    route_target: row.route_target || null,
    execution_layer: row.execution_layer || null,
    connector_family: row.connector_family || null,
    module_binding: row.module_binding || null,
    endpoint_group: row.endpoint_group || null,
    runtime_capability_class: row.runtime_capability_class || null,
    primary_executor: row.primary_executor || null,
    status: row.status || null,
    protocol: {
      hints: protocolHints,
      protocol_agnostic: true,
      plugin_container_key: row.connector_family || row.module_binding || row.endpoint_group || null,
      supported_container_model: "plugin_protocol_action_binding",
    },
    requirements: {
      runtime_callable: runtimeCallable(row),
      review_required: isTruthy(row.review_required),
      request_envelope_required: isTruthy(row.request_envelope_required),
      structured_api_supported: isTruthy(row.structured_api_supported),
      conversational_trigger_supported: isTruthy(row.conversational_trigger_supported),
      client_interface_agnostic: isTruthy(row.client_interface_agnostic),
      provider_agnostic: isTruthy(row.provider_agnostic),
      has_required_variable_contracts: splitTokens(row.required_variable_contracts).length > 0,
    },
    auth_policy: {
      api_key_mode: row.api_key_mode || null,
      api_key_param_name: row.api_key_param_name || null,
      api_key_header_name: row.api_key_header_name || null,
      api_key_storage_mode: row.api_key_storage_mode || null,
      oauth_binding_status: row.oauth_binding_status || null,
      oauth_secret_storage_type: row.oauth_secret_storage_type || null,
      has_secret_reference: Boolean(row.has_secret_ref),
      has_oauth_config_ref: Boolean(row.has_oauth_config_ref),
      has_oauth_client_id_ref: Boolean(row.has_oauth_client_id_ref),
      has_oauth_client_secret_ref: Boolean(row.has_oauth_client_secret_ref),
      secret_values_included: false,
    },
    schema_contract: {
      has_openai_schema_file: Boolean(row.has_openai_schema_file),
      has_schema_json: Boolean(row.has_schema_json),
      has_openai_schema_ref: Boolean(row.has_openai_schema_ref),
      openai_schema_file_name: row.openai_schema_file_name || null,
      openai_schema_storage_surface: row.openai_schema_storage_surface || null,
      schema_imported_at: row.schema_imported_at || null,
    },
    constraints: {
      allowed_actor_roles: splitTokens(row.allowed_actor_roles),
      allowed_governance_levels: splitTokens(row.allowed_governance_levels),
      client_allowed: row.client_allowed || null,
      team_allowed: row.team_allowed || null,
      admin_only: isTruthy(row.admin_only),
      writeback_scope: splitTokens(row.writeback_scope),
    },
    customization: {
      layers: evaluation.customization_layers || [],
      base_action: (evaluation.customization_layers || []).includes("platform_base"),
      specialized: (evaluation.customization_layers || []).some((layer) => layer !== "platform_base"),
      override_model: "registry_row_layered_customization",
    },
    evaluation: {
      allowed: evaluation.allowed === true,
      score: evaluation.score || 0,
      reasons: evaluation.reasons || [],
      matches: evaluation.matches || [],
    },
    notes: compact(row.notes, 1000) || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

export async function resolveActionCandidates({
  pool = getPool(),
  action_key = null,
  action_id = null,
  route_target = null,
  connector_family = null,
  module_binding = null,
  endpoint_group = null,
  runtime_capability_class = null,
  primary_executor = null,
  action_class = null,
  action_scope = null,
  execution_layer = null,
  requested_protocol = null,
  protocol = null,
  requested_credential_scope = null,
  credential_scope = null,
  tenant_id = null,
  user_id = null,
  actor_role = null,
  governance_level = null,
  client_key = null,
  team_key = null,
  is_admin = false,
  require_runtime_callable = true,
  requires_schema_contract = false,
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
  const params = [];
  const requestedActionKey = action_key || action_id;
  if (requestedActionKey) {
    where.push("(action_key = ? OR action_id = ?)");
    params.push(requestedActionKey, requestedActionKey);
  }
  if (route_target) {
    where.push("(route_target = ? OR action_key = ?)");
    params.push(route_target, route_target);
  }
  if (connector_family) {
    where.push("(connector_family = ? OR connector_family LIKE ?)");
    params.push(connector_family, `%${connector_family}%`);
  }
  if (module_binding) {
    where.push("(module_binding = ? OR module_binding LIKE ?)");
    params.push(module_binding, `%${module_binding}%`);
  }
  if (endpoint_group) {
    where.push("(endpoint_group = ? OR endpoint_group LIKE ?)");
    params.push(endpoint_group, `%${endpoint_group}%`);
  }
  if (runtime_capability_class) {
    where.push("(runtime_capability_class IS NULL OR runtime_capability_class = '' OR runtime_capability_class = ?)");
    params.push(runtime_capability_class);
  }
  if (primary_executor) {
    where.push("(primary_executor IS NULL OR primary_executor = '' OR primary_executor = ?)");
    params.push(primary_executor);
  }

  const [rows] = await pool.query(
    `SELECT id, action_id, action_key, action_title, action_class, action_scope,
            trigger_phrase, route_target, execution_layer, dependencies,
            logging_target, inventory_role, openai_action_binding, endpoint_group,
            status, module_binding, connector_family, api_key_mode,
            api_key_param_name, api_key_header_name, api_key_storage_mode,
            openai_schema_file_id IS NOT NULL AS has_openai_schema_file,
            schema_json IS NOT NULL AS has_schema_json,
            import_job_id, schema_imported_at, oauth_config_file_id IS NOT NULL AS has_oauth_config_file,
            oauth_config_file_name, runtime_capability_class, runtime_callable,
            primary_executor, notes, openai_schema_ref IS NOT NULL AS has_openai_schema_ref,
            oauth_config_ref IS NOT NULL AS has_oauth_config_ref,
            oauth_client_id_ref IS NOT NULL AS has_oauth_client_id_ref,
            oauth_client_secret_ref IS NOT NULL AS has_oauth_client_secret_ref,
            oauth_secret_storage_type, oauth_binding_status, oauth_last_validated_at,
            secret_store_ref IS NOT NULL AS has_secret_ref,
            openai_schema_file_name, openai_schema_storage_surface,
            required_variable_contracts, runtime_binding_profile,
            client_interface_agnostic, request_envelope_required,
            structured_api_supported, conversational_trigger_supported,
            provider_agnostic, allowed_actor_roles, allowed_governance_levels,
            client_allowed, team_allowed, admin_only, writeback_scope,
            review_required, created_at, updated_at
       FROM \`actions\`
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT 250`,
    params
  );

  const input = {
    action_key: requestedActionKey,
    route_target,
    connector_family,
    module_binding,
    endpoint_group,
    runtime_capability_class,
    primary_executor,
    action_class,
    action_scope,
    execution_layer,
    requested_protocol: requested_protocol || protocol,
    requested_credential_scope: requested_credential_scope || credential_scope,
    tenant_id,
    user_id,
    actor_role,
    governance_level,
    client_key,
    team_key,
    is_admin,
    require_runtime_callable,
    requires_schema_contract,
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
      action_key: requestedActionKey || null,
      route_target: route_target || null,
      connector_family: connector_family || null,
      module_binding: module_binding || null,
      endpoint_group: endpoint_group || null,
      runtime_capability_class: runtime_capability_class || null,
      primary_executor: primary_executor || null,
      action_class: action_class || null,
      action_scope: action_scope || null,
      execution_layer: execution_layer || null,
      requested_protocol: requested_protocol || protocol || null,
      requested_credential_scope: requested_credential_scope || credential_scope || null,
      tenant_id: tenant_id || null,
      user_id: user_id || null,
      actor_role: actor_role || null,
      governance_level: governance_level || null,
      client_key: client_key || null,
      team_key: team_key || null,
      require_runtime_callable: require_runtime_callable !== false,
      requires_schema_contract: requires_schema_contract === true,
      include_denied: include_denied === true,
    },
    count: candidates.length,
    candidates,
    customization_model: {
      base_layer: "platform_base actions registry rows",
      specialization_layers: [
        "connector_family_or_plugin_container",
        "protocol_binding_hints",
        "runtime_capability_class",
        "primary_executor",
        "auth_policy",
        "schema_contract",
        "client_allowed_or_tenant_context",
        "team_allowed",
        "allowed_actor_roles",
        "allowed_governance_levels",
        "writeback_and_review_requirements",
      ],
      future_override_layers: [
        "plugin_protocol_bindings",
        "plugin_action_bindings",
        "tenant_plugin_policies",
        "user_plugin_connections",
        "agent_skill_grants",
        "endpoint_registry_authority_resolver",
      ],
      protocol_model: "plugin_is_container_protocols_are_bindings_actions_are_governed_verbs",
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
