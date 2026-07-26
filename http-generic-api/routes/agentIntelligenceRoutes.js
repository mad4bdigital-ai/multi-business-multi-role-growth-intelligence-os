import { Router } from "express";
import {
  buildCanonicalModelRunEvents,
  buildCanonicalModelRunPlan,
  searchAgentTools,
} from "../agentIntelligenceRuntime.js";

function requireString(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    const err = new Error(`${field} is required.`);
    err.status = 400;
    err.code = `${field}_required`;
    throw err;
  }
  return text;
}

export function buildAgentIntelligenceRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal];

  router.post("/ai/model-runs", ...requireAdmin, async (req, res) => {
    try {
      const plan = buildCanonicalModelRunPlan(req.body || {});
      res.json({ ok: true, dry_run_only: true, plan });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "ai_model_run_plan_failed", message: error.message } });
    }
  });

  router.get("/ai/model-runs/:id/events", ...requireAdmin, async (req, res) => {
    try {
      const modelRunId = requireString(req.params.id, "model_run_id");
      const events = buildCanonicalModelRunEvents({ model_run_id: modelRunId });
      res.json({ ok: true, ...events });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "ai_model_run_events_failed", message: error.message } });
    }
  });

  router.post("/ai/tool-search", ...requireAdmin, async (req, res) => {
    try {
      const result = await searchAgentTools(req.body || {}, deps);
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: { code: error.code || "ai_tool_search_failed", message: error.message } });
    }
  });

  return router;
}
