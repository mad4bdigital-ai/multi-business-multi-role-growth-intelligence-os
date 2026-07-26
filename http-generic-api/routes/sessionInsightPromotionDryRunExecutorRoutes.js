import { Router } from "express";
import { previewSessionInsightPromotionExecution } from "../sessionInsightPromotionDryRunExecutorService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight promotion dry-run request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPromotionDryRunExecutorRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/executor/dry-run", async (req, res) => {
    try {
      const result = await previewSessionInsightPromotionExecution({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_promotion_executor_dry_run_failed");
    }
  });

  return router;
}
