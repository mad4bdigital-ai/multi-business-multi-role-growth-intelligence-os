import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopeDispatchReadback,
  listSessionInsightCapabilityEnvelopeDispatchReadbacks,
} from "../sessionInsightCapabilityEnvelopeDispatchReadbackService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope dispatch readback failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeDispatchReadbackRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-dispatch-readbacks/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopeDispatchReadback({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_dispatch_readback_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-dispatch-readbacks/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeDispatchReadbacks({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_dispatch_readback_list_failed");
    }
  });

  return router;
}
