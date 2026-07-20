import { Router } from "express";
import {
  createReleaseAdvisorRun,
  getReleaseAdvisorRun,
} from "../selfHealingReleaseAdvisorService.js";

function sendError(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "release_advisor_internal_error",
      message: error?.message || "Release advisor request failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function buildSelfHealingReleaseAdvisorRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  resolveRequestedBy,
}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/admin/release-advisor-runs", ...guards, async (req, res) => {
    try {
      const result = await createReleaseAdvisorRun({
        ...(req.body || {}),
        created_by: resolveRequestedBy?.(req) || "gpt_admin",
      });
      return res.status(result.deduplicated ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/admin/release-advisor-runs/:advisorRunId", ...guards, async (req, res) => {
    try {
      return res.status(200).json(await getReleaseAdvisorRun(req.params.advisorRunId));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
