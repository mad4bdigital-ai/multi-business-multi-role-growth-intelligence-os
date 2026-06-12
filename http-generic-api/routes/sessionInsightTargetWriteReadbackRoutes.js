import { Router } from "express";
import { createSessionInsightTargetWriteReadback, listSessionInsightTargetWriteReadbacks } from "../sessionInsightTargetWriteReadbackService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: String(err.message || "Session insight target write readback failed.").slice(0, 300), details: err.details || null },
    secrets_included: false,
  });
}

export function buildSessionInsightTargetWriteReadbackRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);
  router.post("/platform/session-insight-promotions/target-write-readbacks/create", async (req, res) => {
    try { return res.json(await createSessionInsightTargetWriteReadback({ input: req.body || {} })); }
    catch (err) { return errorResponse(res, err, "session_insight_target_write_readback_create_failed"); }
  });
  router.post("/platform/session-insight-promotions/target-write-readbacks/list", async (req, res) => {
    try { return res.json(await listSessionInsightTargetWriteReadbacks({ filters: req.body || {} })); }
    catch (err) { return errorResponse(res, err, "session_insight_target_write_readback_list_failed"); }
  });
  return router;
}
