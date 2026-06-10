import { Router } from "express";
import { decideSessionInsightCapabilityEnvelopeRequestGateReview } from "../sessionInsightCapabilityEnvelopeRequestGateReviewService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope request gate review failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeRequestGateReviewRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-request-gates/review/decision", async (req, res) => {
    try {
      const result = await decideSessionInsightCapabilityEnvelopeRequestGateReview({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_request_gate_review_decision_failed");
    }
  });

  return router;
}
