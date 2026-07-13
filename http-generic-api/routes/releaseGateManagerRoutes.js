import { Router } from "express";
import {
  closeReleaseGate,
  expireReleaseGate,
  hardDisableReleaseGate,
  listReleaseGates,
  openReleaseGate,
  readReleaseGate,
  reconcileReleaseGates,
} from "../releaseGateManagerService.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "release_gate_internal_error",
      message: error?.message || "Release gate request failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function buildReleaseGateManagerRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/admin/release-gates/open", ...guards, async (req, res) => {
    try { return res.status(201).json(await openReleaseGate(req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  router.post("/admin/release-gates/reconcile", ...guards, async (req, res) => {
    try { return res.status(200).json(await reconcileReleaseGates(req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  router.get("/admin/release-gates", ...guards, async (req, res) => {
    try { return res.status(200).json(await listReleaseGates(req.query || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  router.get("/admin/release-gates/:gateId", ...guards, async (req, res) => {
    try { return res.status(200).json(await readReleaseGate(req.params.gateId)); }
    catch (error) { return errorResponse(res, error); }
  });

  router.post("/admin/release-gates/:gateId/close", ...guards, async (req, res) => {
    try { return res.status(200).json(await closeReleaseGate(req.params.gateId, req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  router.post("/admin/release-gates/:gateId/expire", ...guards, async (req, res) => {
    try { return res.status(200).json(await expireReleaseGate(req.params.gateId, req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  router.post("/admin/release-gates/:gateId/hard-disable", ...guards, async (req, res) => {
    try { return res.status(200).json(await hardDisableReleaseGate(req.params.gateId, req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });

  return router;
}
