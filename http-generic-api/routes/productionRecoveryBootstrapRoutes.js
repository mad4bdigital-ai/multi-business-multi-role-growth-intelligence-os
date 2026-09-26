import { Router } from "express";
import {
  applyProductionRecoveryControlStoreBootstrapPlan,
  buildProductionRecoveryControlStoreBootstrapPlan,
  inspectProductionRecoveryControlStoreBootstrap,
} from "../productionRecoveryControlStoreBootstrap.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "production_recovery_control_store_bootstrap_failed",
      message: error?.message || "Production Recovery Control Store bootstrap request failed.",
      details: error?.details || {},
    },
    database_mutation_performed: false,
    target_database_mutation_performed: false,
    provider_mutation_performed: false,
    production_runtime_mutation_performed: false,
    secrets_included: false,
  });
}

export function buildProductionRecoveryBootstrapRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  env = process.env,
  poolProvider,
  readinessReader,
} = {}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter((value) => typeof value === "function");
  if (guards.length !== 2) {
    throw new Error("Production Recovery bootstrap routes require backend-key and admin-principal guards.");
  }

  router.use("/admin/recovery-bootstrap", ...guards);

  const deps = {
    env,
    ...(typeof poolProvider === "function" ? { poolProvider } : {}),
    ...(typeof readinessReader === "function" ? { readinessReader } : {}),
  };

  router.get("/admin/recovery-bootstrap/status", async (req, res) => {
    try {
      const expectedSha = String(req.query?.expected_sha || "").trim();
      return res.status(200).json(await inspectProductionRecoveryControlStoreBootstrap(
        expectedSha ? { expected_sha: expectedSha } : {},
        deps,
      ));
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/admin/recovery-bootstrap/plan", async (req, res) => {
    try {
      return res.status(200).json(await buildProductionRecoveryControlStoreBootstrapPlan(
        req.body || {},
        deps,
      ));
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/admin/recovery-bootstrap/apply", async (req, res) => {
    try {
      const result = await applyProductionRecoveryControlStoreBootstrapPlan(
        req.body || {},
        deps,
      );
      return res.status(result?.ok === true ? 200 : 409).json(result);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  return router;
}
