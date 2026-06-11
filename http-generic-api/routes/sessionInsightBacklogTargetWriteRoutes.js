import { Router } from "express";
import {
  executeSessionInsightBacklogTargetWrite,
  listSessionInsightBacklogTargetWrites,
  rollbackSessionInsightBacklogTargetWrite,
} from "../sessionInsightBacklogTargetWriteService.js";

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Session insight backlog target write failed.").slice(0, 300),
      details: err.details || null,
    },
    secrets_included: false,
  });
}

export function buildSessionInsightBacklogTargetWriteRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/platform/session-insight-promotions/backlog-target-writes/execute", async (req, res) => {
    try {
      const result = await executeSessionInsightBacklogTargetWrite({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_backlog_target_write_execute_failed");
    }
  });

  router.post("/platform/session-insight-promotions/backlog-target-writes/list", async (req, res) => {
    try {
      const result = await listSessionInsightBacklogTargetWrites({ filters: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_backlog_target_write_list_failed");
    }
  });

  router.post("/platform/session-insight-promotions/backlog-target-writes/rollback", async (req, res) => {
    try {
      const result = await rollbackSessionInsightBacklogTargetWrite({ input: req.body || {} });
      return res.json(result);
    } catch (err) {
      return errorResponse(res, err, "session_insight_backlog_target_write_rollback_failed");
    }
  });

  return router;
}
