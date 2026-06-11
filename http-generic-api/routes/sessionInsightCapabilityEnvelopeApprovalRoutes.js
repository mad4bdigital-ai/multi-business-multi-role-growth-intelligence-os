import { Router } from "express";
import {
  decideSessionInsightCapabilityEnvelopeApproval,
  listSessionInsightCapabilityEnvelopeApprovals,
} from "../sessionInsightCapabilityEnvelopeApprovalService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope approval failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeApprovalRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-approvals/decision", async (req, res) => {
    try {
      const result = await decideSessionInsightCapabilityEnvelopeApproval({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_approval_decision_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-approvals/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeApprovals({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_approval_list_failed");
    }
  });

  return router;
}
