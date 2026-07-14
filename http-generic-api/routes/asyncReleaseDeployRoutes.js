import { Router } from "express";
import {
  getAsyncReleaseDeployStatus,
  reconcileAsyncReleaseDeploy,
  submitAsyncReleaseDeploy,
} from "../asyncReleaseDeployService.js";

function sendError(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "release_async_deploy_internal_error",
      message: error?.message || "Async deploy request failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function buildAsyncReleaseDeployRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  executionFacade,
  resolveRequestedBy,
}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/admin/release-operations/:operationId/async-deploy", ...guards, async (req, res) => {
    try {
      const requestedBy = resolveRequestedBy?.(req) || "gpt_admin";
      const idempotencyKey = String(req.body?.idempotency_key || req.header("Idempotency-Key") || "").trim();
      const result = await submitAsyncReleaseDeploy({
        operationId: req.params.operationId,
        body: req.body || {},
        requestedBy,
        idempotencyKey,
        executionFacade,
      });
      return res.status(result.status).json(result.body);
    } catch (error) { return sendError(res, error); }
  });

  router.get("/admin/release-operations/:operationId/async-deploy", ...guards, async (req, res) => {
    try { return res.status(200).json(await getAsyncReleaseDeployStatus({ operationId: req.params.operationId, executionFacade })); }
    catch (error) { return sendError(res, error); }
  });

  router.post("/admin/release-operations/:operationId/async-deploy/readback", ...guards, async (req, res) => {
    try { return res.status(200).json(await reconcileAsyncReleaseDeploy({ operationId: req.params.operationId, executionFacade })); }
    catch (error) { return sendError(res, error); }
  });

  return router;
}
