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
  return ["false", "0", "no", "n", "inactive", "disabled", "blocked", "archived", "retired"].includes(normalize(value));
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

function priorityScore(priority = "", weight = "") {
  const p = normalize(priority || weight);
  if (p === "critical" || p === "p0") return 400;
  if (p === "high" || p === "p1") return 300;
  if (p === "medium" || p === "p2") return 200;
  if (p === "low" || p === "p3") return 100;
  const n = Number(p);
  return Number.isFinite(n) ? Math.max(0, 500 - n) : 0;
}

function workflowActive(row = {}) {
  if (isDisabled(row.active) || isDisabled(row.status)) return false;
  if (row.active || row.status) return isTruthy(row.active) || ["active", "ready", "beta", "enabled"].includes(normalize(row.status));
  return true;
}

function textMatches(value = "", requested = null) {
  const req = normalize(requested || "");
  if (!req) return { matched: true, score: 0, reason: "not_requested" };
  const tokens = splitTokens(value);
  if (!tokens.length) return { matched: true, score: 0, reason: "no_constraint" };
  for (const token of tokens) {
    const n = normalize(token);
    if (["*", "all", "any"].includes(n)) return { matched: true, score: 1, reason: "wildcard" };
    if (n === req) return { matched: true, score: 30, reason: "exact" };
    if (req.includes(n) || n.includes(req)) return { matched: true, score: 10, reason: "partial" };
  }
  return { matched: false, score: -50, reason: "not_matched" };
}

function deriveCustomizationLayers(row = {}, input = {}) {
  const layers = ["platform_base"];
  if (input.brand_key || input.brandKey) {
    if (isTruthy(row.brand_scope_enforced) || row.route_compatibility || row.input_detection_rules) layers.push("brand_or_activity_specialization");
  }
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
  if (row.supported_model_providers || row.model_adapter_required || row.supports_structured_api_calls) layers.push("model_capability_specialization");
  if (row.memory_required || row.logging_required || row.review_required) layers.push("governance_requirement_specialization");
  return [...new Set(layers)];
}

function evaluateWorkflow(row = {}, input = {}) {
  const reasons = [];
  const matches = [];
  let score = priorityScore(row.priority, row.entry_priority_weight);

  if (!workflowActive(row)) {
    return { allowed: false, score: -1000, reasons: ["workflow_inactive"], matches, customization_layers: [] };
  }

  const adminRequested = input.is_admin === true || normalize(input.actor_role || input.actorRole) === "admin";
  if (isTruthy(row.admin_only) && !adminRequested) reasons.push("admin_only_workflow");

  const workflowKey = input.workflow_key || input.workflowKey;
  if (workflowKey) {
    if (normalize(row.workflow_key) === normalize(workflowKey) || normalize(row.workflow_id) === normalize(workflowKey)) {
      score += 140;
      matches.push({ field: row.workflow_key ? "workflow_key" : "workflow_id", type: "exact", value: compact(row.workflow_key || row.workflow_id, 160) });
    } else {
      reasons.push("workflow_key_not_matched");
    }
  }

  const routeKey = input.route_key || input.routeKey;
  if (routeKey) {
    const routeMatch = textMatches(row.route_key || row.route_compatibility || row.trigger_source, routeKey);
    if (routeMatch.matched) {
      score += routeMatch.score + 40;
      matches.push({ field: "route_key", type: routeMatch.reason, value: compact(row.route_key || row.route_compatibility || row.trigger_source, 160) });
    } else {
      reasons.push("route_key_not_matched");
    }
  }

  const targetModule = input.target_module || input.targetModule;
  if (targetModule && row.target_module && normalize(row.target_module) !== normalize(targetModule)) reasons.push("target_module_not_matched");
  else if (targetModule && row.target_module) score += 20;

  const workflowType = input.workflow_type || input.workflowType;
  if (workflowType && row.workflow_type && normalize(row.workflow_type) !== normalize(workflowType)) reasons.push("workflow_type_not_matched");
  else if (workflowType && row.workflow_type) score += 15;

  const executionClass = input.execution_class || input.executionClass;
  if (executionClass && row.execution_class && normalize(row.execution_class) !== normalize(executionClass)) reasons.push("execution_class_not_matched");
  else if (executionClass && row.execution_class) score += 15;

  const executionMode = input.execution_mode || input.executionMode;
  if (executionMode && row.execution_mode && normalize(row.execution_mode) !== normalize(executionMode)) reasons.push("execution_mode_not_matched");
  else if (executionMode && row.execution_mode) score += 10;

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
  if (!fieldAllows(row.supported_ingress_channels || row.trigger_source, ingress, { emptyAllows: true })) reasons.push("ingress_channel_not_allowed");
  else if (ingress && (row.supported_ingress_channels || row.trigger_source)) score += 15;

  const modelProvider = input.model_provider || input.modelProvider;
  if (!fieldAllows(row.supported_model_providers, modelProvider, { emptyAllows: true })) reasons.push("model_provider_not_allowed");
  else if (modelProvider && row.supported_model_providers) score += 15;

  const language = input.language || input.locale;
  if (!fieldAllows(row.supported_languages, language, { emptyAllows: true })) reasons.push("language_not_allowed");
  else if (language && row.supported_languages) score += 10;

  const inputType = input.input_type || input.inputType;
  if (inputType && row.input_type && normalize(row.input_type) !== normalize(inputType)) reasons.push("input_type_not_matched");
  else if (inputType && row.input_type) score += 10;

  const allowed = reasons.length === 0;
  return {
    allowed,
    score: allowed ? score : score - 200,
    reasons,
    matches,
    customization_layers: deriveCustomizationLayers(row, input),
  };
}

function sanitizeWorkflow(row = {}, evaluation = {}) {
  return {
    workflow_id: row.workflow_id || null,
    workflow_key: row.workflow_key || row.workflow_id || null,
    workflow_name: row.workflow_name || null,
    workflow_type: row.workflow_type || null,
    route_key: row.route_key || null,
    target_module: row.target_module || null,
    module_mode: row.module_mode || null,
    execution_mode: row.execution_mode || null,
    execution_class: row.execution_class || null,
    lifecycle_mode: row.lifecycle_mode || null,
    priority: row.priority || row.entry_priority_weight || null,
    primary_objective: compact(row.primary_objective, 1200) || null,
    primary_output: compact(row.primary_output, 1000) || null,
    output_artifact_type: row.output_artifact_type || null,
    mapped_engines: splitTokens(row.mapped_engines),
    linked_engines: splitTokens(row.linked_engines),
    engine_order: splitTokens(row.engine_order),
    linked_workflows: splitTokens(row.linked_workflows),
    requirements: {
      memory_required: isTruthy(row.memory_required),
      logging_required: isTruthy(row.logging_required),
      review_required: isTruthy(row.review_required),
      supports_structured_api_calls: isTruthy(row.supports_structured_api_calls),
      model_adapter_required: isTruthy(row.model_adapter_required),
    },
    constraints: {
      route_compatibility: splitTokens(row.route_compatibility),
      allowed_states: splitTokens(row.allowed_states),
      supported_ingress_channels: splitTokens(row.supported_ingress_channels || row.trigger_source),
      supported_model_providers: splitTokens(row.supported_model_providers),
      allowed_actor_roles: splitTokens(row.allowed_actor_roles),
      allowed_governance_levels: splitTokens(row.allowed_governance_levels),
      supported_languages: splitTokens(row.supported_languages),
      locale_sensitive: isTruthy(row.locale_sensitive),
      translation_step_required: isTruthy(row.translation_step_required),
      admin_only: isTruthy(row.admin_only),
      user_facing: isTruthy(row.user_facing),
    },
    customization: {
      layers: evaluation.customization_layers || [],
      base_workflow: (evaluation.customization_layers || []).includes("platform_base"),
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
    registry_source: row.registry_source || null,
    last_validated_at: row.last_validated_at || null,
    secrets_included: false,
  };
}

export async function resolveWorkflowCandidates({
  pool = getPool(),
  workflow_key = null,
  workflow_id = null,
  route_key = null,
  target_module = null,
  workflow_type = null,
  execution_class = null,
  execution_mode = null,
  input_type = null,
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
  is_admin = false,
  include_denied = false,
  limit = 10,
} = {}) {
  const surfaceAuthority = await assertSurfaceAuthority(
    SURFACE_KEYS.WORKFLOW_REGISTRY,
    { requireExecution: true },
    { pool }
  );

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const where = ["1 = 1"];
  const params = [];
  const requestedWorkflowKey = workflow_key || workflow_id;
  if (requestedWorkflowKey) {
    where.push("(workflow_key = ? OR workflow_id = ?)");
    params.push(requestedWorkflowKey, requestedWorkflowKey);
  }
  if (route_key) {
    where.push("(route_key = ? OR route_compatibility LIKE ? OR trigger_source LIKE ?)");
    params.push(route_key, `%${route_key}%`, `%${route_key}%`);
  }
  if (target_module) {
    where.push("(target_module IS NULL OR target_module = '' OR target_module = ?)");
    params.push(target_module);
  }
  if (workflow_type) {
    where.push("(workflow_type IS NULL OR workflow_type = '' OR workflow_type = ?)");
    params.push(workflow_type);
  }
  if (execution_class) {
    where.push("(execution_class IS NULL OR execution_class = '' OR execution_class = ?)");
    params.push(execution_class);
  }

  const [rows] = await pool.query(
    `SELECT id, workflow_id, workflow_name, module_mode, trigger_source,
            input_type, primary_objective, mapped_engines, engine_order,
            workflow_type, primary_output, input_detection_rules,
            output_template, priority, route_key, execution_mode, user_facing,
            parent_layer, status, linked_workflows, linked_engines, notes,
            entry_priority_weight, dependency_type, output_artifact_type,
            workflow_key, active, target_module, execution_class,
            lifecycle_mode, route_compatibility, memory_required,
            logging_required, review_required, allowed_states, degraded_action,
            blocked_action, registry_source, last_validated_at,
            required_variable_profile, input_contract_profile,
            supported_ingress_channels, supports_structured_api_calls,
            supported_model_providers, model_adapter_required,
            allowed_actor_roles, allowed_governance_levels, client_allowed,
            team_allowed, admin_only, brand_scope_enforced,
            supported_languages, translation_step_required, locale_sensitive,
            created_at, updated_at
       FROM \`workflows\`
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT 250`,
    params
  );

  const input = {
    workflow_key: requestedWorkflowKey,
    route_key,
    target_module,
    workflow_type,
    execution_class,
    execution_mode,
    input_type,
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
    is_admin,
  };

  const candidates = (rows || [])
    .map((row) => sanitizeWorkflow(row, evaluateWorkflow(row, input)))
    .filter((candidate) => include_denied || candidate.evaluation.allowed)
    .sort((a, b) => (b.evaluation.score || 0) - (a.evaluation.score || 0))
    .slice(0, safeLimit);

  return {
    ok: true,
    resolver: "shared_workflow_registry_authority_resolver",
    mode: "read_model_only",
    requested: {
      workflow_key: requestedWorkflowKey || null,
      route_key: route_key || null,
      target_module: target_module || null,
      workflow_type: workflow_type || null,
      execution_class: execution_class || null,
      execution_mode: execution_mode || null,
      input_type: input_type || null,
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
      include_denied: include_denied === true,
    },
    count: candidates.length,
    candidates,
    customization_model: {
      base_layer: "platform_base workflow registry rows",
      specialization_layers: [
        "route_key",
        "target_module",
        "brand_or_activity_context",
        "client_allowed_or_tenant_context",
        "team_allowed",
        "allowed_actor_roles",
        "allowed_governance_levels",
        "supported_ingress_channels",
        "supported_model_providers",
        "supported_languages",
        "memory_logging_review_requirements",
      ],
      future_override_layers: [
        "tenant_workflow_overrides",
        "user_workflow_preferences",
        "agent_skill_grants",
        "workflow_policy_overrides",
        "engine_order_overrides",
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
