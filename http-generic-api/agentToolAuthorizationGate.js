import { getPool } from "./db.js";
import { resolveUserBrandSkillEntitlement } from "./userBrandSkillEntitlement.js";

const CONSEQUENCE_PATTERN = /(?:^|[._-])(write|create|insert|update|delete|remove|apply|execute|dispatch|send|publish|deploy|restart|stop|start|install|uninstall|trigger|mutate|mutation|shell|control|approve|revoke|rollback|migrate|sync)(?:$|[._-])/i;
const READ_ONLY_PATTERN = /(?:^|[._-])(read|get|list|search|inspect|status|preview|diagnostic|health|lookup|resolve|validate|verify|dry[_-]?run|plan)(?:$|[._-])/i;

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["1", "true", "yes", "active", "enabled", "allowed", "allow"].includes(normalize(value));
}

function splitTokens(value = "") {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => normalize(item))
    .filter(Boolean);
}

function compactAction(row = null) {
  if (!row) return null;
  return {
    action_key: row.action_key || null,
    status: row.status || null,
    runtime_callable: isTruthy(row.runtime_callable),
    runtime_capability_class: row.runtime_capability_class || null,
    admin_only: isTruthy(row.admin_only),
    review_required: isTruthy(row.review_required),
    allowed_actor_roles: splitTokens(row.allowed_actor_roles),
    allowed_governance_levels: splitTokens(row.allowed_governance_levels),
    secrets_included: false,
  };
}

function dependencyFailure(error, fallbackCode) {
  return {
    code: normalize(error?.code || fallbackCode).slice(0, 128) || fallbackCode,
    message: String(error?.message || "Dependency resolution failed.").slice(0, 255),
    secrets_included: false,
  };
}

export function classifyAgentTool(toolName = "", args = {}, action = null) {
  const name = normalize(toolName);
  const argumentKeys = Object.keys(args && typeof args === "object" && !Array.isArray(args) ? args : {});
  const argumentSignal = argumentKeys.join("_");
  const capabilityClass = normalize(action?.runtime_capability_class);
  const explicitReadOnly = READ_ONLY_PATTERN.test(name) && !CONSEQUENCE_PATTERN.test(name);
  const consequential = CONSEQUENCE_PATTERN.test(name) || CONSEQUENCE_PATTERN.test(argumentSignal) ||
    ["mcp_connector", "http_transport_executor", "system_control", "data_write"].includes(capabilityClass);
  return {
    consequence_class: consequential ? "consequential" : explicitReadOnly ? "read_only" : "advisory",
    consequential,
    explicit_read_only: explicitReadOnly,
    secrets_included: false,
  };
}

export function inferRequiredSkillAlternatives(toolName = "", action = null) {
  const name = normalize(`${toolName} ${action?.action_key || ""} ${action?.connector_family || ""}`);
  if (/wordpress/.test(name) && CONSEQUENCE_PATTERN.test(name)) return ["api.wordpress_write"];
  if (/wordpress/.test(name)) return ["api.wordpress_read", "api.wordpress_write"];
  if (/(make|mcp)/.test(name)) return ["api.make_mcp"];
  if (/(local.*shell|shell.*local|shell_execute)/.test(name)) return ["local.connector.shell_execute"];
  if (/(local.*file|file_access)/.test(name)) return ["local.connector.file_access"];
  if (/(local.*device|device_management)/.test(name)) return ["local.connector.device_management"];
  if (/(output_artifact|artifact_write)/.test(name)) return ["data.write_output_artifacts", "data_readwrite_platform"];
  if (/(write_logic|logic_definition.*write)/.test(name)) return ["system.write_logic_definitions", "system_control_admin"];
  if (/assimilate.*session/.test(name)) return ["system.assimilate_sessions", "system_control_admin"];
  if (/(chain.*dispatch|trigger_chain)/.test(name)) return ["system.trigger_chain_dispatch", "system_control_admin"];
  if (/(logic.*evaluate|evaluate.*pack)/.test(name)) return ["logic.evaluate_pack", "logic_execution_platform"];
  return [];
}

async function loadAction(pool, toolName) {
  const [rows] = await pool.query(
    `SELECT action_key, status, runtime_callable, runtime_capability_class,
            connector_family, admin_only, review_required,
            allowed_actor_roles, allowed_governance_levels
       FROM actions
      WHERE action_key = ?
         OR openai_action_binding = ?
         OR action_title = ?
      ORDER BY action_key = ? DESC, updated_at DESC, action_key ASC
      LIMIT 2`,
    [toolName, toolName, toolName, toolName]
  );
  const exactMatch = rows.find((row) => normalize(row.action_key) === normalize(toolName));
  if (exactMatch) return exactMatch;
  const [candidate, duplicate] = rows;
  if (duplicate) {
    const error = new Error("Multiple action registry entries match the requested tool name.");
    error.code = "AGENT_TOOL_ACTION_AMBIGUOUS";
    throw error;
  }
  return candidate || null;
}

async function resolveSkillGrant(pool, alternatives, context) {
  if (!alternatives.length) return { required: false, granted: true, matched_skill_key: null };
  const agentId = String(context.agent_id || "").trim();
  if (!agentId) return { required: true, granted: false, matched_skill_key: null, reason: "agent_identity_required" };
  const tenantId = String(context.tenant_id || "").trim();
  const brandKey = String(context.brand_key || context.target_key || "").trim();
  const placeholders = alternatives.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT DISTINCT sk.skill_key
       FROM v_effective_agent_skill_grants sg
       JOIN agent_skills sk ON sk.skill_id = sg.skill_id AND sk.status = 'active'
      WHERE sg.agent_id = ?
        AND sg.status = 'active'
        AND (sg.expires_at IS NULL OR sg.expires_at > CURRENT_TIMESTAMP)
        AND (sg.tenant_id IS NULL OR sg.tenant_id = ?)
        AND (sg.brand_key IS NULL OR sg.brand_key = ?)
        AND sk.skill_key IN (${placeholders})
      ORDER BY FIELD(sk.skill_key, ${placeholders})
      LIMIT 1`,
    [agentId, tenantId, brandKey, ...alternatives, ...alternatives]
  );
  const [match] = rows;
  return {
    required: true,
    granted: Boolean(match),
    matched_skill_key: match?.skill_key || null,
    reason: match ? null : "required_agent_skill_grant_missing",
  };
}

async function resolveAppActionGrant(pool, actionKey, context) {
  if (!actionKey) return { configured: false, granted: true };
  const [configuredRows] = await pool.query(
    `SELECT COUNT(*) AS configured_count
       FROM app_action_grants
      WHERE action_key = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [actionKey]
  );
  const [configuredRow = {}] = configuredRows;
  const configuredCount = Number(configuredRow.configured_count || 0);
  if (!configuredCount) return { configured: false, granted: true };
  const [matchingRows] = await pool.query(
    `SELECT grant_id
       FROM app_action_grants
      WHERE action_key = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND (agent_id IS NULL OR agent_id = ?)
        AND (workspace_id IS NULL OR workspace_id = ?)
      ORDER BY (agent_id IS NOT NULL) DESC,
               (workspace_id IS NOT NULL) DESC,
               grant_id ASC
      LIMIT 1`,
    [actionKey, context.agent_id || "", context.workspace_id || ""]
  );
  const [matchingGrant] = matchingRows;
  return {
    configured: true,
    granted: Boolean(matchingGrant),
    grant_id: matchingGrant?.grant_id || null,
  };
}

function actorEvidence(context = {}) {
  const actorRole = normalize(context.actor_role || context.role_key || context.actor_type || "");
  const governanceLevel = normalize(context.governance_level || context.execution_class || "");
  const isAdmin = context.is_admin === true || /admin/.test(actorRole) || governanceLevel === "authority";
  return { actor_role: actorRole || null, governance_level: governanceLevel || null, is_admin: isAdmin };
}

export async function authorizeAgentToolCall({
  tool_name,
  args = {},
  context = {},
  phase = "dispatch",
  pool = null,
} = {}) {
  const toolName = String(tool_name || "").trim();
  if (!toolName) {
    return { allowed: false, status: "denied", code: "agent_tool_name_required", phase, secrets_included: false };
  }
  const db = pool || getPool();
  let action = null;
  let actionResolutionFailure = null;
  try {
    action = await loadAction(db, toolName);
  } catch (error) {
    actionResolutionFailure = dependencyFailure(error, "action_registry_resolution_failed");
  }
  const classification = classifyAgentTool(toolName, args, action);
  const actor = actorEvidence(context);
  const blockers = [];

  if (actionResolutionFailure) {
    blockers.push("action_registry_resolution_failed");
  } else if (action) {
    if (!isTruthy(action.status) && normalize(action.status) !== "active") blockers.push("action_not_active");
    if (!isTruthy(action.runtime_callable)) blockers.push("action_not_runtime_callable");
    if (isTruthy(action.admin_only) && !actor.is_admin) blockers.push("action_admin_principal_required");
    const allowedRoles = splitTokens(action.allowed_actor_roles);
    if (allowedRoles.length && !actor.is_admin) {
      if (!actor.actor_role) blockers.push("action_actor_role_required");
      else if (!allowedRoles.includes(actor.actor_role)) blockers.push("action_actor_role_denied");
    }
    const allowedGovernance = splitTokens(action.allowed_governance_levels);
    if (allowedGovernance.length && !actor.is_admin) {
      if (!actor.governance_level) blockers.push("action_governance_level_required");
      else if (!allowedGovernance.includes(actor.governance_level)) blockers.push("action_governance_level_denied");
    }
  } else if (classification.consequential || phase === "exposure") {
    blockers.push(phase === "exposure"
      ? "tool_registry_authority_required_for_model_exposure"
      : "consequential_tool_registry_authority_missing");
  }

  const requiredSkills = inferRequiredSkillAlternatives(toolName, action);
  const skill = await resolveSkillGrant(db, requiredSkills, context).catch((error) => ({
    required: requiredSkills.length > 0,
    granted: false,
    matched_skill_key: null,
    reason: "agent_skill_grant_resolution_failed",
    dependency_failure: dependencyFailure(error, "agent_skill_grant_resolution_failed"),
  }));
  if (classification.consequential && skill.required && !skill.granted) blockers.push(skill.reason || "required_agent_skill_grant_missing");

  const userBrandSkillGrant = await resolveUserBrandSkillEntitlement(db, skill, context, {
    toolName,
    args,
    action,
  }).catch((error) => ({
    configured: true,
    granted: false,
    grant_id: null,
    operation: null,
    reason: "user_brand_skill_grant_resolution_failed",
    dependency_failure: dependencyFailure(error, "user_brand_skill_grant_resolution_failed"),
  }));
  if (classification.consequential && userBrandSkillGrant.configured && !userBrandSkillGrant.granted) {
    blockers.push(userBrandSkillGrant.reason || "user_brand_skill_grant_missing");
  }

  const appGrant = await resolveAppActionGrant(db, action?.action_key, context).catch((error) => ({
    configured: true,
    granted: false,
    reason: "app_action_grant_resolution_failed",
    dependency_failure: dependencyFailure(error, "app_action_grant_resolution_failed"),
  }));
  if (appGrant.configured && !appGrant.granted) blockers.push(appGrant.reason || "app_action_grant_missing");

  const allowed = blockers.length === 0;
  return {
    allowed,
    status: allowed ? "authorized" : "denied",
    code: allowed ? "agent_tool_authorized" : blockers[0],
    phase,
    tool_key: toolName,
    classification,
    action: compactAction(action),
    action_registry: {
      resolved: !actionResolutionFailure,
      failure: actionResolutionFailure,
      secrets_included: false,
    },
    skill: {
      required: skill.required,
      alternatives: requiredSkills,
      granted: skill.granted,
      matched_skill_key: skill.matched_skill_key || null,
      dependency_failure: skill.dependency_failure || null,
    },
    user_brand_skill_grant: {
      configured: userBrandSkillGrant.configured,
      granted: userBrandSkillGrant.granted,
      grant_id: userBrandSkillGrant.grant_id || null,
      operation: userBrandSkillGrant.operation || null,
      reason: userBrandSkillGrant.reason || null,
      dependency_failure: userBrandSkillGrant.dependency_failure || null,
    },
    app_action_grant: {
      configured: appGrant.configured,
      granted: appGrant.granted,
      grant_id: appGrant.grant_id || null,
      dependency_failure: appGrant.dependency_failure || null,
    },
    actor,
    blockers,
    advisory_unregistered_read_only: !action && !classification.consequential && !actionResolutionFailure,
    secrets_included: false,
  };
}

export async function filterAuthorizedAgentTools(tools = [], context = {}, options = {}) {
  const decisions = [];
  const authorizedTools = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const toolName = tool?.function?.name || tool?.name || "";
    const decision = await authorizeAgentToolCall({
      tool_name: toolName,
      args: {},
      context,
      phase: "exposure",
      pool: options.pool,
    });
    decisions.push(decision);
    if (decision.allowed) authorizedTools.push(tool);
  }
  return {
    tools: authorizedTools,
    decisions,
    candidate_count: Array.isArray(tools) ? tools.length : 0,
    authorized_count: authorizedTools.length,
    denied_count: decisions.filter((decision) => !decision.allowed).length,
    secrets_included: false,
  };
}
