import { Router } from "express";
import {
  createSessionInsightRemainingScopeCompletion,
  listSessionInsightRemainingScopeCompletions,
} from "../sessionInsightRemainingScopeCompletionService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight remaining scope completion failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightRemainingScopeCompletionRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/remaining-scope-completions/create", async (req, res) => {
    try {
      const result = await createSessionInsightRemainingScopeCompletion({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_remaining_scope_completion_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/remaining-scope-completions/list", async (req, res) => {
    try {
      const result = await listSessionInsightRemainingScopeCompletions({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_remaining_scope_completion_list_failed");
    }
  });

  return router;
}
