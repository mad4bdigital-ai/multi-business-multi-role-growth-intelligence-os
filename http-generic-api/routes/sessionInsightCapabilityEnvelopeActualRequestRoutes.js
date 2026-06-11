import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopeActualRequest,
  listSessionInsightCapabilityEnvelopeActualRequests,
} from "../sessionInsightCapabilityEnvelopeActualRequestService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope actual request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeActualRequestRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-actual-requests/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopeActualRequest({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_actual_request_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-actual-requests/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeActualRequests({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_actual_request_list_failed");
    }
  });

  return router;
}
