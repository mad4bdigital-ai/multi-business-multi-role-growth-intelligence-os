import { Router } from "express";
import { decideSessionInsightCapabilityEnvelopeDispatchDryRunReview } from "../sessionInsightCapabilityEnvelopeDispatchDryRunReviewService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope dispatch dry-run review failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeDispatchDryRunReviewRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-dispatch-dry-runs/review/decision", async (req, res) => {
    try {
      const result = await decideSessionInsightCapabilityEnvelopeDispatchDryRunReview({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_dispatch_dry_run_review_decision_failed");
    }
  });

  return router;
}
