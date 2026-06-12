import { Router } from "express";
import {
  buildActivationHardRunSummary,
  createRuntimeVerificationRun,
  getRuntimeParity,
  getRuntimeVerificationRun,
  listRuntimeVerificationEvidence,
} from "../runtimeVerificationService.js";

function actorFromRequest(req) {
  return {
    user_id: req.user?.user_id || req.user?.id || req.auth?.user_id || null,
    email: req.user?.email || req.auth?.email || null,
    mode: "admin_runtime_verification_route",
  };
}

function parseLimit(value, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 100);
}

export function buildRuntimeVerificationRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/runtime/verification-runs", ...guards, async (req, res, next) => {
    try {
      const run = await createRuntimeVerificationRun(req.body || {}, actorFromRequest(req));
      res.status(201).json({ ok: true, ...run });
    } catch (error) {
      next(error);
    }
  });

  router.get("/runtime/verification-runs/:runId", ...guards, async (req, res, next) => {
    try {
      const run = await getRuntimeVerificationRun(req.params.runId);
      if (!run) return res.status(404).json({ ok: false, error: { code: "runtime_verification_run_not_found", message: "Runtime verification run was not found." } });
      return res.status(200).json({ ok: true, ...run });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/runtime/verification-runs/:runId/evidence", ...guards, async (req, res, next) => {
    try {
      const evidence = await listRuntimeVerificationEvidence(req.params.runId, {
        surface: req.query.surface,
        limit: parseLimit(req.query.limit),
        cursor: req.query.cursor || 0,
      });
      res.status(200).json({ ok: true, run_id: req.params.runId, ...evidence });
    } catch (error) {
      next(error);
    }
  });

  router.get("/runtime/parity/:environmentKey?", ...guards, async (req, res, next) => {
    try {
      const parity = await getRuntimeParity(req.params.environmentKey || req.query.environment_key || "production");
      res.status(200).json({ ok: true, ...parity });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
