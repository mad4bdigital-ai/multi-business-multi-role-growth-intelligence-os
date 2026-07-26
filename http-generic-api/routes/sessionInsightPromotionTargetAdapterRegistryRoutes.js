import { Router } from "express";
import { readSessionInsightTargetAdapterRegistry } from "../sessionInsightPromotionTargetAdapterRegistryService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight target adapter registry request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPromotionTargetAdapterRegistryRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/target-adapters/list", async (req, res) => {
    try {
      const result = await readSessionInsightTargetAdapterRegistry({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_target_adapter_registry_list_failed");
    }
  });

  return router;
}
