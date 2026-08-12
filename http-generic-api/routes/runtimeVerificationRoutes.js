import { Router } from "express";
import * as legacy from "./runtimeVerificationRoutesLegacy.js";
import { createRuntimeVerificationRun } from "../runtimeVerificationService.js";
import { recordRuntimeBreakGlassVerificationReadback } from "../runtimeBreakGlassVerificationReadbackService.js";
import { getGovernancePool } from "../governanceDb.js";

export * from "./runtimeVerificationRoutesLegacy.js";

function actorFromRequest(req) {
  return {
    user_id: req.user?.user_id || req.user?.id || req.auth?.user_id || null,
    email: req.user?.email || req.auth?.email || null,
    mode: "admin_runtime_verification_route",
  };
}

export function buildRuntimeVerificationRoutes(deps = {}) {
  const router = Router();
  const guards = [deps.requireBackendApiKey, deps.requireAdminPrincipal].filter(Boolean);

  router.post("/runtime/verification-runs", ...guards, async (req, res, next) => {
    const input = req.body || {};
    const breakGlassId = String(input.break_glass_id || "").trim();
    if (!breakGlassId) return next();
    try {
      const run = await createRuntimeVerificationRun(input, actorFromRequest(req));
      const readback = await recordRuntimeBreakGlassVerificationReadback(
        { runId: run.run_id, breakGlassId },
        { pool: getGovernancePool() },
      );
      if (!readback.matches_post_change_hashes) {
        return res.status(424).json({
          ok: false,
          ...run,
          runtime_break_glass_readback: readback,
          error: {
            code: "runtime_break_glass_readback_hash_mismatch",
            message: "Run-bound runtime break-glass readback does not match the persisted post-change hashes.",
          },
          secrets_included: false,
        });
      }
      return res.status(201).json({ ok: true, ...run, runtime_break_glass_readback: readback, secrets_included: false });
    } catch (error) {
      return next(error);
    }
  });

  router.use(legacy.buildRuntimeVerificationRoutes(deps));
  return router;
}
