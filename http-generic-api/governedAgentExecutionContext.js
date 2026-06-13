import {
  resolveAgentResponseProfile,
  resolveMemoryScope,
  resolveResearchSourcePolicy,
} from "./agentGovernanceRuntime.js";

async function poolFrom(deps = {}) {
  if (deps.pool) return deps.pool;
  const { getPool } = await import("./db.js");
  return getPool();
}

async function defaultTaskRouteResolver(input) {
  const { resolveTaskRouteCandidates } = await import("./taskRouteAuthorityResolver.js");
  return resolveTaskRouteCandidates(input);
}

async function defaultWorkflowResolver(input) {
  const { resolveWorkflowCandidates } = await import("./workflowRegistryAuthorityResolver.js");
  return resolveWorkflowCandidates(input);
}

function compactCandidate(candidate = {}, type) {
  return {
    key: type === "route" ? candidate.route_id || candidate.task_key : candidate.workflow_key || candidate.workflow_id,
    allowed: candidate.evaluation?.allowed === true,
    score: candidate.evaluation?.score || 0,
    reasons: candidate.evaluation?.reasons || [],
    blocked_action: candidate.blocked_action || null,
    requirements: candidate.requirements || {},
    secrets_included: false,
  };
}

function explicitCandidateDenied(candidates = [], expectedKeys = []) {
  const keys = new Set(expectedKeys.filter(Boolean).map(String));
  if (!keys.size) return null;
  return candidates.find((candidate) => keys.has(String(candidate.key)) && candidate.allowed === false) || null;
}

async function safely(label, operation) {
  try {
    return await operation();
  } catch (error) {
    return {
      ok: false,
      resolver: label,
      error: error?.code || error?.message || `${label}_failed`,
      secrets_included: false,
    };
  }
}

export async function buildGovernedAgentExecutionContext(plan = {}, deps = {}) {
  const pool = await poolFrom(deps);
  const enforcementMode = String(deps.enforcementMode || process.env.AGENT_AUTHORITY_BRIDGE_MODE || "observe_only").toLowerCase();
  const shared = {
    pool,
    brand_key: plan.brand_key || plan.target_key || null,
    tenant_id: plan.tenant_id || null,
    user_id: plan.user_id || null,
    actor_role: plan.actor_role || plan.role_key || null,
    governance_level: plan.governance_level || null,
    client_key: plan.client_key || plan.tenant_id || null,
    team_key: plan.team_key || null,
    entry_source: plan.entry_source || null,
    ingress_channel: plan.ingress_channel || plan.channel || null,
    model_provider: plan.model_provider || null,
    language: plan.language || plan.locale || null,
    is_admin: plan.is_admin === true,
    include_denied: true,
    limit: 10,
  };
  const taskRouteResolver = deps.resolveTaskRouteCandidates || defaultTaskRouteResolver;
  const workflowResolver = deps.resolveWorkflowCandidates || defaultWorkflowResolver;
  const profileResolver = deps.resolveAgentResponseProfile || resolveAgentResponseProfile;
  const researchResolver = deps.resolveResearchSourcePolicy || resolveResearchSourcePolicy;
  const memoryResolver = deps.resolveMemoryScope || resolveMemoryScope;

  const [routes, workflows, responseProfile, researchPolicy, memoryScope] = await Promise.all([
    safely("task_route_authority", () => taskRouteResolver({
      ...shared,
      intent_key: plan.intent_key || null,
      task_key: plan.task_key || null,
      request_type: plan.request_type || null,
      route_mode: plan.route_mode || null,
    })),
    safely("workflow_authority", () => workflowResolver({
      ...shared,
      workflow_key: plan.workflow_key || null,
      workflow_id: plan.workflow_id || null,
      route_key: plan.route_key || plan.intent_key || null,
      target_module: plan.target_module || null,
      execution_class: plan.execution_class || null,
      execution_mode: plan.execution_mode || plan.service_mode || null,
      input_type: plan.input_type || null,
    })),
    safely("response_profile", () => profileResolver({
      tenant_id: plan.tenant_id,
      brand_key: plan.brand_key || plan.target_key,
      role_key: plan.actor_role || plan.role_key,
      channel: plan.ingress_channel || plan.channel,
      agent_id: plan.agent_id,
      workflow_key: plan.workflow_key,
    }, { pool })),
    safely("research_source_policy", () => researchResolver({
      tenant_id: plan.tenant_id,
      brand_key: plan.brand_key || plan.target_key,
      workflow_key: plan.workflow_key,
      question_class: plan.question_class || plan.intent_key || "general",
    }, { pool })),
    plan.tenant_id
      ? safely("memory_scope", () => memoryResolver({
        tenant_id: plan.tenant_id,
        scopes: {
          tenant: plan.tenant_id,
          workspace: plan.workspace_id || plan.workspace_key,
          brand: plan.brand_key || plan.target_key,
          role: plan.actor_role || plan.role_key,
          agent: plan.agent_id,
          workflow: plan.workflow_key || plan.workflow_id,
        },
      }, { pool }))
      : Promise.resolve({ ok: false, resolver: "memory_scope", error: "tenant_id_missing", secrets_included: false }),
  ]);

  const routeCandidates = (routes.candidates || []).map((candidate) => compactCandidate(candidate, "route"));
  const workflowCandidates = (workflows.candidates || []).map((candidate) => compactCandidate(candidate, "workflow"));
  const deniedRoute = explicitCandidateDenied(routeCandidates, [plan.route_id, plan.route_key, plan.task_key, plan.intent_key]);
  const deniedWorkflow = explicitCandidateDenied(workflowCandidates, [plan.workflow_key, plan.workflow_id]);
  const blockers = [
    ...(deniedRoute ? [{ code: "explicit_task_route_denied", evidence: deniedRoute }] : []),
    ...(deniedWorkflow ? [{ code: "explicit_workflow_denied", evidence: deniedWorkflow }] : []),
  ];
  const enforce = enforcementMode === "enforce";

  return {
    plan_id: plan.plan_id || null,
    tenant_id: plan.tenant_id || null,
    brand_key: plan.brand_key || plan.target_key || null,
    workflow_key: plan.workflow_key || null,
    authority_bridge: {
      mode: enforce ? "enforce" : "observe_only",
      allowed: !enforce || blockers.length === 0,
      blocker_count: blockers.length,
      blockers,
      route_candidates: routeCandidates,
      workflow_candidates: workflowCandidates,
      secrets_included: false,
    },
    response_profile: responseProfile,
    research_policy: researchPolicy,
    memory_scope: memoryScope,
    prompt_envelope: {
      authority_mode: enforce ? "enforce" : "observe_only",
      authority_allowed: !enforce || blockers.length === 0,
      route: routeCandidates.find((candidate) => candidate.allowed) || null,
      workflow: workflowCandidates.find((candidate) => candidate.allowed) || null,
      response_profile: {
        language: responseProfile.language || null,
        channel: responseProfile.channel || null,
        tone: responseProfile.tone || null,
        verbosity: responseProfile.verbosity || null,
        format_policy: responseProfile.format_policy || {},
        citation_policy: responseProfile.citation_policy || {},
      },
      research_policy: {
        policy_key: researchPolicy.policy_key || null,
        source_order: researchPolicy.source_order || [],
        internal_first: researchPolicy.internal_first === true,
      },
      memory_scope: {
        primary_scope: memoryScope.primary_scope || null,
        cross_scope_default: memoryScope.cross_scope_default || "deny",
      },
      secrets_included: false,
    },
    secrets_included: false,
  };
}
