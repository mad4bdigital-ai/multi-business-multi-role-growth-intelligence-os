import { Router } from "express";
import { createSessionInsightPromotionApplyRequest } from "../sessionInsightPromotionApplyRequestService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight promotion apply request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPromotionApplyRequestRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/apply/request", async (req, res) => {
    try {
      const result = await createSessionInsightPromotionApplyRequest({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_promotion_apply_request_failed");
    }
  });

  return router;
}
