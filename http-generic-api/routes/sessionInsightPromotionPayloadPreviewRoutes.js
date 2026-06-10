import { Router } from "express";
import { generateSessionInsightContractPayloadPreview } from "../sessionInsightPromotionPayloadPreviewService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight contract payload preview request failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightPromotionPayloadPreviewRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/payload-preview/generate", async (req, res) => {
    try {
      const result = await generateSessionInsightContractPayloadPreview({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_contract_payload_preview_failed");
    }
  });

  return router;
}
