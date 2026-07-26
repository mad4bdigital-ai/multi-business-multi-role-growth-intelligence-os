import { Router } from "express";
import {
  createSessionInsightCapabilityEnvelopeAdapterExecutionGate,
  listSessionInsightCapabilityEnvelopeAdapterExecutionGates,
} from "../sessionInsightCapabilityEnvelopeAdapterExecutionGateService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight capability envelope adapter execution gate failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightCapabilityEnvelopeAdapterExecutionGateRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/capability-envelope-adapter-execution-gates/create", async (req, res) => {
    try {
      const result = await createSessionInsightCapabilityEnvelopeAdapterExecutionGate({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_adapter_execution_gate_create_failed");
    }
  });

  router.post("/platform/session-insight-promotions/capability-envelope-adapter-execution-gates/list", async (req, res) => {
    try {
      const result = await listSessionInsightCapabilityEnvelopeAdapterExecutionGates({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_capability_envelope_adapter_execution_gate_list_failed");
    }
  });

  return router;
}
