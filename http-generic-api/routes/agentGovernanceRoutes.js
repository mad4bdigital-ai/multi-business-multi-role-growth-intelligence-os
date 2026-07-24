import { Router } from "express";
import {
  consumeAgentHandoffState,
  createGovernedResearchPlan,
  createAgentHandoffState,
  getSkillRuntimeCoverage,
  getAgentGovernanceReadiness,
  persistExternalPromptArtifact,
  readAgentHandoffState,
  recordResearchSourceExecution,
  resolveAgentResponseProfile,
  resolveResearchSourcePolicy,
  runGovernedResearchPlan,
  revokeAgentHandoffState,
  resolveMemoryScope,
} from "../agentGovernanceRuntime.js";
import {
  getEngineRuntimeCoverage,
  getLogicRuntimeCoverage,
} from "../capabilityCoverageRuntime.js";

function sendError(res, error, fallback) {
  res.status(error.status || 500).json({ ok: false, error: { code: error.code || fallback, message: error.message } });
}

function principalActor(req) {
  return String(req.auth?.user_id || req.auth?.admin_id || req.auth?.email || req.auth?.sub || req.auth?.mode || "admin").trim();
}

function auditedInput(req, input = {}) {
  const actorId = principalActor(req);
  const { actor_id: _ignoredActorId, principal_actor_id: _ignoredPrincipalActorId, ...safeInput } = input || {};
  return {
    ...safeInput,
    actor_id: actorId,
    principal_actor_id: actorId,
  };
}

export function buildAgentGovernanceRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const guards = [requireBackendApiKey, requireAdminPrincipal];

  router.post("/platform/agent-governance/response-profile/resolve", ...guards, async (req, res) => {
    try { res.json({ ok: true, profile: await resolveAgentResponseProfile(req.body || {}, deps) }); }
    catch (error) { sendError(res, error, "agent_response_profile_resolve_failed"); }
  });
  router.post("/platform/agent-governance/research-policy/resolve", ...guards, async (req, res) => {
    try { res.json({ ok: true, policy: await resolveResearchSourcePolicy(req.body || {}, deps) }); }
    catch (error) { sendError(res, error, "research_source_policy_resolve_failed"); }
  });
  router.post("/platform/agent-governance/research-executions", ...guards, async (req, res) => {
    try { res.status(201).json({ ok: true, result: await recordResearchSourceExecution(auditedInput(req, req.body || {}), deps) }); }
    catch (error) { sendError(res, error, "research_source_execution_write_failed"); }
  });
  router.post("/platform/agent-governance/research-plans", ...guards, async (req, res) => {
    try {
      const input = auditedInput(req, {
        ...(req.body || {}),
        idempotency_key: req.body?.idempotency_key || req.header("Idempotency-Key") || "",
      });
      res.status(201).json({ ok: true, plan: await createGovernedResearchPlan(input, deps) });
    }
    catch (error) { sendError(res, error, "governed_research_plan_create_failed"); }
  });
  router.post("/platform/agent-governance/research-plans/:plan_id/run", ...guards, async (req, res) => {
    try { res.json(await runGovernedResearchPlan(auditedInput(req, { ...(req.body || {}), plan_id: req.params.plan_id }), deps)); }
    catch (error) { sendError(res, error, "governed_research_plan_run_failed"); }
  });
  router.post("/platform/agent-governance/handoffs", ...guards, async (req, res) => {
    try { res.status(201).json({ ok: true, handoff: await createAgentHandoffState(auditedInput(req, req.body || {}), deps) }); }
    catch (error) { sendError(res, error, "agent_handoff_create_failed"); }
  });
  router.get("/platform/agent-governance/handoffs/:state_id", ...guards, async (req, res) => {
    try { res.json(await readAgentHandoffState(req.params.state_id, auditedInput(req, req.query || {}), deps)); }
    catch (error) { sendError(res, error, "agent_handoff_read_failed"); }
  });
  router.post("/platform/agent-governance/handoffs/:state_id/consume", ...guards, async (req, res) => {
    try { res.json(await consumeAgentHandoffState(req.params.state_id, auditedInput(req, req.body || {}), deps)); }
    catch (error) { sendError(res, error, "agent_handoff_consume_failed"); }
  });
  router.post("/platform/agent-governance/handoffs/:state_id/revoke", ...guards, async (req, res) => {
    try { res.json(await revokeAgentHandoffState(req.params.state_id, auditedInput(req, req.body || {}), deps)); }
    catch (error) { sendError(res, error, "agent_handoff_revoke_failed"); }
  });
  router.post("/platform/agent-governance/external-prompts/classify", ...guards, async (req, res) => {
    try { res.status(201).json({ ok: true, artifact: await persistExternalPromptArtifact(auditedInput(req, req.body || {}), deps) }); }
    catch (error) { sendError(res, error, "external_prompt_classification_failed"); }
  });
  router.get("/platform/agent-governance/skill-coverage", ...guards, async (req, res) => {
    try { res.json({ ok: true, coverage: await getSkillRuntimeCoverage(req.query || {}, deps) }); }
    catch (error) { sendError(res, error, "skill_runtime_coverage_failed"); }
  });
  router.get("/platform/agent-governance/logic-coverage", ...guards, async (req, res) => {
    try { res.json({ ok: true, coverage: await getLogicRuntimeCoverage(req.query || {}, deps) }); }
    catch (error) { sendError(res, error, "logic_runtime_coverage_failed"); }
  });
  router.get("/platform/agent-governance/engine-coverage", ...guards, async (req, res) => {
    try { res.json({ ok: true, coverage: await getEngineRuntimeCoverage(req.query || {}, deps) }); }
    catch (error) { sendError(res, error, "engine_runtime_coverage_failed"); }
  });
  router.get("/platform/agent-governance/readiness", ...guards, async (req, res) => {
    try { res.json({ ok: true, readiness: await getAgentGovernanceReadiness(req.query || {}, deps) }); }
    catch (error) { sendError(res, error, "agent_governance_readiness_failed"); }
  });
  router.post("/platform/agent-governance/memory-scope/resolve", ...guards, async (req, res) => {
    try { res.json({ ok: true, memory_scope: await resolveMemoryScope(req.body || {}, deps) }); }
    catch (error) { sendError(res, error, "memory_scope_resolve_failed"); }
  });
  return router;
}
