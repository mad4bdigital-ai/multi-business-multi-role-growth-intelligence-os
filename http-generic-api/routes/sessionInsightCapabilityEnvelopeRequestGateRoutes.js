import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopeRequestGate,
  listSessionInsightCapabilityEnvelopeRequestGates,
} from "../sessionInsightCapabilityEnvelopeRequestGateService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope request gate failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeRequestGateRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-request-gates/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopeRequestGate({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_request_gate_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-request-gates/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeRequestGates({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_request_gate_list_failed");
    }
  });

  return router;
}
