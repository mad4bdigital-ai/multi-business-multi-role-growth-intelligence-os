import { Router } from "express";
import {
  appendReleaseGateEvent,
  appendReleaseOperationEvidence,
  appendReleaseOperationStep,
  createReleaseOperation,
  finalizeReleaseOperation,
  getReleaseOperation,
  listReleaseOperations,
} from "../releaseOperationService.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "release_operation_internal_error",
      message: error?.message || "Release operation request failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function buildReleaseOperationRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);
  router.post("/admin/release-operations", ...guards, async (req, res) => {
    try { return res.status(201).json(await createReleaseOperation(req.body || {})); } catch (error) { return errorResponse(res, error); }
  });
  router.get("/admin/release-operations", ...guards, async (req, res) => {
    try { return res.status(200).json(await listReleaseOperations(req.query || {})); } catch (error) { return errorResponse(res, error); }
  });
  router.get("/admin/release-operations/:operationId", ...guards, async (req, res) => {
    try { return res.status(200).json(await getReleaseOperation(req.params.operationId)); } catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/release-operations/:operationId/steps", ...guards, async (req, res) => {
    try { return res.status(200).json(await appendReleaseOperationStep(req.params.operationId, req.body || {})); } catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/release-operations/:operationId/evidence", ...guards, async (req, res) => {
    try { return res.status(200).json(await appendReleaseOperationEvidence(req.params.operationId, req.body || {})); } catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/release-operations/:operationId/gate-events", ...guards, async (req, res) => {
    try { return res.status(200).json(await appendReleaseGateEvent(req.params.operationId, req.body || {})); } catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/release-operations/:operationId/finalize", ...guards, async (req, res) => {
    try { return res.status(200).json(await finalizeReleaseOperation(req.params.operationId, req.body || {})); } catch (error) { return errorResponse(res, error); }
  });
  return router;
}
