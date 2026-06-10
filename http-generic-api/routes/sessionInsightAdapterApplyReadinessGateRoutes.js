import { Router } from "express";
import { listSessionInsightAdapterApplyReadinessGate } from "../sessionInsightAdapterApplyReadinessGateService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight adapter apply readiness gate request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightAdapterApplyReadinessGateRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/adapter-apply-readiness/list", async (req, res) => {
    try {
      const result = await listSessionInsightAdapterApplyReadinessGate({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_adapter_apply_readiness_gate_list_failed");
    }
  });

  return router;
}
