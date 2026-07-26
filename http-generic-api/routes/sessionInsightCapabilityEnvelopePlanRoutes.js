import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopePlan,
  listSessionInsightCapabilityEnvelopePlans,
} from "../sessionInsightCapabilityEnvelopePlanService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope plan request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopePlanRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-plans/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopePlan({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_plan_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-plans/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopePlans({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_plan_list_failed");
    }
  });

  return router;
}
