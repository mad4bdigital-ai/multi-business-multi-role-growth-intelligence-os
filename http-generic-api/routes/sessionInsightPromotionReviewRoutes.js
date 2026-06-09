import { Router } from "express";
import {
  decideSessionInsightPromotionReview,
  listSessionInsightPromotionReviews,
} from "../sessionInsightPromotionReviewService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight promotion review request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPromotionReviewRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/review/list", async (req, res) => {
    try {
      const result = await listSessionInsightPromotionReviews({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_promotion_review_list_failed");
    }
  });

  router.post("/platform/session-insight-promotions/review/decision", async (req, res) => {
    try {
      const result = await decideSessionInsightPromotionReview({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_promotion_review_decision_failed");
    }
  });

  return router;
}
