import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopeActualRequestPreflight,
  listSessionInsightCapabilityEnvelopeActualRequestPreflights,
} from "../sessionInsightCapabilityEnvelopeActualRequestPreflightService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope actual request preflight failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeActualRequestPreflightRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-actual-requests/preflights/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopeActualRequestPreflight({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_actual_request_preflight_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-actual-requests/preflights/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeActualRequestPreflights({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_actual_request_preflight_list_failed");
    }
  });

  return router;
}
