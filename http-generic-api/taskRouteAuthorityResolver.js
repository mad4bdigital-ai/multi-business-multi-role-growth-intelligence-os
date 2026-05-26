import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function compact(value = "", max = 500) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["true", "1", "yes", "y", "active", "enabled", "allow", "allowed"].includes(normalize(value));
}

function isDisabled(value) {
  return ["false", "0", "no", "n", "inactive", "disabled", "blocked", "archived", "retired"].includes(normalize(value));
}

function splitTokens(value = "") {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedTokenSet(value = "") {
  return new Set(splitTokens(value).map(normalize));
}

function fieldAllows(value, requested = null, { emptyAllows = true } = {}) {
  const tokens = normalizedTokenSet(value);
  if (!tokens.size) return emptyAllows;
  if (tokens.has("*") || tokens.has("all") || tokens.has("any")) return true;
  const req = normalize(requested || "");
  if (!req) return emptyAllows;
  return tokens.has(req);
}

function fieldBlocksByFalse(value) {
  const text = normalize(value);
  return isDisabled(text);
}

function priorityScore(priority = "") {
  const value = normalize(priority);
  if (value === "critical" || value === "p0") return 400;
  if (value === "high" || value === "p1") return 300;
  if (value === "medium" || value === "p2") return 200;
  if (value === "low" || value === "p3") return 100;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, 500 - numeric) : 0;
}

function matchTextList(value = "", requested = null) {
  const req = normalize(requested || "");
  if (!req) return { matched: true, score: 0, reason: "not_requested" };
  const tokens = splitTokens(value);
  if (!tokens.length) return { matched: true, score: 0, reason: "no_constraint" };
  for (const token of tokens) {
    const normalized = normalize(token);
    if (["*", "all", "any"].includes(normalized)) return { matched: true, score: 1, reason: "wildcard" };
    if (normalized === req) return { matched: true, score: 20, reason: "exact" };
    if (req.includes(normalized) || normalized.includes(req)) return { matched: true, score: 8, reason: "partial" };
  }
  return { matched: false, score: -50, reason: "not_allowed" };
}

function routeActive(row = {}) {
  if (fieldBlocksByFalse(row.active) || fieldBlocksByFalse(row.enabled)) return false;
  if (row.active || row.enabled) return isTruthy(row.active) || isTruthy(row.enabled);
  return true;
}

function deriveCustomizationLayers(row = {}, input = {}) {
  const layers = ["platform_base"];
  const brandScope = normalize(row.brand_scope);
  const brand = normalize(input.brand_key || input.brandKey);
  if (brand && brandScope && !["all", "global", "platform", "*"].includes(brandScope)) layers.push("brand_specialization");
  if (input.tenant_id || input.tenantId || input.client_key || input.clientKey) {
    const clientField = normalize(row.client_allowed);
    if (clientField && !["all", "any", "*"].includes(clientField)) layers.push("client_specialization");
  }
  if (input.team_key || input.teamKey) {
    const teamField = normalize(row.team_allowed);
    if (teamField && !["all", "any", "*"].includes(teamField)) layers.push("team_specialization");
  }
  if (input.user_id || input.userId) layers.push("user_context_available");
  if (row.supported_languages || row.locale_sensitive || row.translation_step_required) layers.push("locale_specialization");
  if (row.supported_model_providers || row.requires_conversational_inference || row.supports_structured_api_calls) layers.push("model_capability_specialization");
  return [...new Set(layers)];
}

function evaluateRoute(row = {}, input = {}) {
  const reasons = [];
  const matches = [];
  let score = priorityScore(row.priority);

  if (!routeActive(row)) {
    return { allowed: false, score: -1000, reasons: ["route_inactive"], matches, customization_layers: [] };
  }

  const adminRequested = input.is_admin === true || normalize(input.actor_role || input.actorRole) === "admin";
  if (isTruthy(row.admin_only) && !adminRequested) reasons.push("admin_only_route");

  const intent = input.intent_key || input.intentKey;
  if (intent) {
    if (normalize(row.intent_key) === normalize(intent)) {
      score += 100;
      matches.push({ field: "intent_key", type: "exact", value: compact(row.intent_key, 160) });
    } else if (normalize(row.task_key) === normalize(intent)) {
      score += 80;
      matches.push({ field: "task_key", type: "exact", value: compact(row.task_key, 160) });
    } else {
      const triggerMatch = matchTextList(row.trigger_terms, intent);
      if (triggerMatch.matched) {
        score += triggerMatch.score;
        matches.push({ field: "trigger_terms", type: triggerMatch.reason });
      } else {
        reasons.push("intent_not_matched");
      }
    }
  }

  const taskKey = input.task_key || input.taskKey;
  if (taskKey && normalize(row.task_key) !== normalize(taskKey)) reasons.push("task_key_not_matched");

  const brand = input.brand_key || input.brandKey;
  if (brand && row.brand_scope_enforced && isTruthy(row.brand_scope_enforced)) {
    const brandMatch = fieldAllows(row.brand_scope, brand, { emptyAllows: false });
    if (!brandMatch) reasons.push("brand_scope_not_allowed");
    else {
      score += 60;
      matches.push({ field: "brand_scope", type: "allowed", value: compact(row.brand_scope, 160) });
    }
  } else if (brand && fieldAllows(row.brand_scope, brand, { emptyAllows: true })) {
    if (normalize(row.brand_scope) && !["*", "all", "global", "platform"].includes(normalize(row.brand_scope))) {
      score += 40;
      matches.push({ field: "brand_scope", type: "specialized", value: compact(row.brand_scope, 160) });
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

  const ingress = input.ingress_channel || input.ingressChannel || input.entry_source || input.entrySource;
  if (!fieldAllows(row.supported_ingress_channels || row.entry_sources, ingress, { emptyAllows: true })) reasons.push("ingress_channel_not_allowed");
  else if (ingress && (row.supported_ingress_channels || row.entry_sources)) score += 15;

  const modelProvider = input.model_provider || input.modelProvider;
  if (!fieldAllows(row.supported_model_providers, modelProvider, { emptyAllows: true })) reasons.push("model_provider_not_allowed");
  else if (modelProvider && row.supported_model_providers) score += 15;

  const language = input.language || input.locale;
  if (!fieldAllows(row.supported_languages, language, { emptyAllows: true })) reasons.push("language_not_allowed");
  else if (language && row.supported_languages) score += 10;

  const requestType = input.request_type || input.requestType;
  if (requestType && row.request_type && normalize(row.request_type) !== normalize(requestType)) reasons.push("request_type_not_matched");
  else if (requestType && row.request_type) score += 15;

  const routeMode = input.route_mode || input.routeMode;
  if (routeMode && row.route_mode && normalize(row.route_mode) !== normalize(routeMode)) reasons.push("route_mode_not_matched");
  else if (routeMode && row.route_mode) score += 10;

  const allowed = reasons.length === 0;
  return {
    allowed,
    score: allowed ? score : score - 200,
    reasons,
    matches,
    customization_layers: deriveCustomizationLayers(row, input),
  };
}

function sanitizeRoute(row = {}, evaluation = {}) {
  return {
    route_id: row.route_id || row.row_id || String(row.id || ""),
    task_key: row.task_key || null,
    intent_key: row.intent_key || null,
    workflow_key: row.workflow_key || null,
    target_module: row.target_module || null,
    route_modules: splitTokens(row.route_modules).slice(0, 20),
    execution_layer: row.execution_layer || null,
    route_mode: row.route_mode || null,
    request_type: row.request_type || null,
    lifecycle_mode: row.lifecycle_mode || null,
    priority: row.priority || null,
    output_focus: compact(row.output_focus, 1000) || null,
    route_source: row.route_source || null,
    requirements: {
      memory_required: isTruthy(row.memory_required),
      logging_required: isTruthy(row.logging_required),
      review_required: isTruthy(row.review_required),
      requires_conversational_inference: isTruthy(row.requires_conversational_inference),
      supports_structured_api_calls: isTruthy(row.supports_structured_api_calls),
    },
    constraints: {
      brand_scope: row.brand_scope || null,
      brand_scope_enforced: isTruthy(row.brand_scope_enforced),
      allowed_states: splitTokens(row.allowed_states),
      supported_ingress_channels: splitTokens(row.supported_ingress_channels || row.entry_sources),
      supported_model_providers: splitTokens(row.supported_model_providers),
      allowed_actor_roles: splitTokens(row.allowed_actor_roles),
      allowed_governance_levels: splitTokens(row.allowed_governance_levels),
      supported_languages: splitTokens(row.supported_languages),
      locale_sensitive: isTruthy(row.locale_sensitive),
      translation_step_required: isTruthy(row.translation_step_required),
      admin_only: isTruthy(row.admin_only),
    },
    customization: {
      layers: evaluation.customization_layers || [],
      base_route: (evaluation.customization_layers || []).includes("platform_base"),
      specialized: (evaluation.customization_layers || []).some((layer) => layer !== "platform_base"),
      override_model: "registry_row_layered_customization",
    },
    evaluation: {
      allowed: evaluation.allowed === true,
      score: evaluation.score || 0,
      reasons: evaluation.reasons || [],
      matches: evaluation.matches || [],
    },
    degraded_action: row.degraded_action || null,
    blocked_action: row.blocked_action || null,
    last_validated_at: row.last_validated_at || null,
    secrets_included: false,
  };
}

export async function resolveTaskRouteCandidates({
  pool = getPool(),
  intent_key = null,
  task_key = null,
  brand_key = null,
  tenant_id = null,
  user_id = null,
  actor_role = null,
  governance_level = null,
  client_key = null,
  team_key = null,
  entry_source = null,
  ingress_channel = null,
  model_provider = null,
  language = null,
  locale = null,
  request_type = null,
  route_mode = null,
  is_admin = false,
  include_denied = false,
  limit = 10,
} = {}) {
  const surfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.TASK_ROUTES,
    { requireExecution: true },
    { pool }
  );

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const queryParts = ["1 = 1"];
  const params = [];
  if (intent_key) {
    queryParts.push("(intent_key = ? OR task_key = ? OR trigger_terms LIKE ?)");
    params.push(intent_key, intent_key, `%${intent_key}%`);
  }
  if (task_key) {
    queryParts.push("task_key = ?");
    params.push(task_key);
  }
  if (request_type) {
    queryParts.push("(request_type IS NULL OR request_type = '' OR request_type = ?)");
    params.push(request_type);
  }
  if (route_mode) {
    queryParts.push("(route_mode IS NULL OR route_mode = '' OR route_mode = ?)");
    params.push(route_mode);
  }

  const [rows] = await pool.query(
    `SELECT id, task_key, trigger_terms, route_modules, execution_layer, priority,
            enabled, output_focus, notes, entry_sources, linked_starter_titles,
            active_starter_count, route_key_match_status, row_id, route_id, active,
            intent_key, brand_scope, request_type, route_mode, target_module,
            workflow_key, lifecycle_mode, memory_required, logging_required,
            review_required, allowed_states, degraded_action, blocked_action,
            match_rule, route_source, last_validated_at, required_variable_profile,
            variable_contract_group, supported_ingress_channels,
            requires_conversational_inference, supports_structured_api_calls,
            supported_model_providers, allowed_actor_roles, allowed_governance_levels,
            client_allowed, team_allowed, admin_only, brand_scope_enforced,
            supported_languages, translation_step_required, locale_sensitive,
            created_at, updated_at
       FROM \`task_routes\`
      WHERE ${queryParts.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT 250`,
    params
  );

  const input = {
    intent_key,
    task_key,
    brand_key,
    tenant_id,
    user_id,
    actor_role,
    governance_level,
    client_key,
    team_key,
    entry_source,
    ingress_channel,
    model_provider,
    language: language || locale,
    request_type,
    route_mode,
    is_admin,
  };

  const candidates = (rows || [])
    .map((row) => {
      const evaluation = evaluateRoute(row, input);
      return sanitizeRoute(row, evaluation);
    })
    .filter((candidate) => include_denied || candidate.evaluation.allowed)
    .sort((a, b) => (b.evaluation.score || 0) - (a.evaluation.score || 0))
    .slice(0, safeLimit);

  return {
    ok: true,
    resolver: "shared_task_route_authority_resolver",
    mode: "read_model_only",
    requested: {
      intent_key: intent_key || null,
      task_key: task_key || null,
      brand_key: brand_key || null,
      tenant_id: tenant_id || null,
      user_id: user_id || null,
      actor_role: actor_role || null,
      governance_level: governance_level || null,
      client_key: client_key || null,
      team_key: team_key || null,
      ingress_channel: ingress_channel || entry_source || null,
      model_provider: model_provider || null,
      language: language || locale || null,
      request_type: request_type || null,
      route_mode: route_mode || null,
      include_denied: include_denied === true,
    },
    count: candidates.length,
    candidates,
    customization_model: {
      base_layer: "platform_base task_routes rows",
      specialization_layers: [
        "brand_scope",
        "client_allowed_or_tenant_context",
        "team_allowed",
        "allowed_actor_roles",
        "allowed_governance_levels",
        "supported_ingress_channels",
        "supported_model_providers",
        "supported_languages",
      ],
      future_override_layers: [
        "tenant_task_route_overrides",
        "user_task_route_preferences",
        "agent_skill_grants",
        "workflow_policy_overrides",
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
