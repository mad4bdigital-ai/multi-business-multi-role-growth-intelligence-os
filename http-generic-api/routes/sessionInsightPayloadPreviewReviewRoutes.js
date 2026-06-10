import { Router } from "express";
import {
  decideSessionInsightPayloadPreviewReview,
  listSessionInsightPayloadPreviewReviews,
} from "../sessionInsightPayloadPreviewReviewService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight payload preview review request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPayloadPreviewReviewRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/payload-preview/review/list", async (req, res) => {
    try {
      const result = await listSessionInsightPayloadPreviewReviews({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_payload_preview_review_list_failed");
    }
  });

  router.post("/platform/session-insight-promotions/payload-preview/review/decision", async (req, res) => {
    try {
      const result = await decideSessionInsightPayloadPreviewReview({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_payload_preview_review_decision_failed");
    }
  });

  return router;
}
