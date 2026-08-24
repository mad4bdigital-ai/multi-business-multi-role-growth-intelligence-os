import { Router } from "express";
import {
  buildRuntimeBreakglassPlan,
  createRuntimeBreakglassRun,
  getRuntimeBreakglassCatalogStatus,
  getRuntimeBreakglassRun,
} from "../runtimeBreakglassBroker.js";

function bodyOf(req) {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
}

function errorResponse(res, error, fallbackCode) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    ok: false,
    error: {
      code: error?.code || fallbackCode,
      message: error?.message || "Runtime Breakglass request failed.",
      details: error?.details || null,
    },
    workflow_dispatch_performed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    secrets_included: false,
  });
}

function requireMiddleware(name, middleware) {
  if (typeof middleware !== "function") {
    const error = new Error(`Runtime Breakglass routes require ${name}.`);
    error.code = "RUNTIME_BREAKGLASS_SECURITY_MIDDLEWARE_REQUIRED";
    throw error;
  }
  return middleware;
}

function makeServiceKeyGuard(requireBackendApiKey) {
  requireMiddleware("requireBackendApiKey", requireBackendApiKey);
  return async function requireBreakglassServiceKey(req, res, next) {
    let guardCompleted = false;
    const proceed = () => {
      guardCompleted = true;
    };
    await requireBackendApiKey(req, res, proceed);
    if (!guardCompleted || res.headersSent) return;
    if (req.auth?.mode !== "backend_api_key" || req.auth?.is_admin !== true) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "runtime_breakglass_backend_service_key_required",
          message: "Runtime Breakglass requires the dedicated backend service API key; user JWT access is not allowed.",
        },
        secrets_included: false,
      });
    }
    return next();
  };
}

function requestForReadback(req) {
  return {
    run_id: req.params.run_id,
    expected_sha: req.query.expected_sha,
    correlation_id: req.query.correlation_id,
  };
}

export function buildRuntimeBreakglassRoutes({
  requireBackendApiKey,
  env = process.env,
  statusReader = getRuntimeBreakglassCatalogStatus,
  planBuilder = buildRuntimeBreakglassPlan,
  runCreator = createRuntimeBreakglassRun,
  runReader = getRuntimeBreakglassRun,
} = {}) {
  const router = Router();
  const requireBreakglassServiceKey = makeServiceKeyGuard(requireBackendApiKey);

  router.get("/admin/runtime-breakglass/status", requireBreakglassServiceKey, async (_req, res) => {
    try {
      return res.status(200).json(statusReader(env));
    } catch (error) {
      return errorResponse(res, error, "RUNTIME_BREAKGLASS_STATUS_FAILED");
    }
  });

  router.post("/admin/runtime-breakglass/runs", requireBreakglassServiceKey, async (req, res) => {
    try {
      const result = await runCreator(bodyOf(req), { env });
      const status = result?.status === "local_operator_required" || result?.error
        ? 409
        : result?.status === "dispatched_run_id_unproven"
          ? 202
          : 200;
      return res.status(status).json(result);
    } catch (error) {
      return errorResponse(res, error, "RUNTIME_BREAKGLASS_RUN_CREATE_FAILED");
    }
  });

  router.get("/admin/runtime-breakglass/runs/:run_id", requireBreakglassServiceKey, async (req, res) => {
    try {
      const input = requestForReadback(req);
      if (!String(input.expected_sha || "").trim() || !String(input.correlation_id || "").trim()) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "runtime_breakglass_readback_binding_required",
            message: "expected_sha and correlation_id are required for exact run readback.",
          },
          secrets_included: false,
        });
      }
      return res.status(200).json(await runReader(input, { env }));
    } catch (error) {
      return errorResponse(res, error, "RUNTIME_BREAKGLASS_RUN_READBACK_FAILED");
    }
  });

  router.get("/deployment-info/runtime-breakglass-status", requireBreakglassServiceKey, async (_req, res) => {
    try {
      return res.status(200).json(statusReader(env));
    } catch (error) {
      return errorResponse(res, error, "RUNTIME_BREAKGLASS_HOST_STATUS_FAILED");
    }
  });

  router.post("/deployment-info/runtime-breakglass-plan", requireBreakglassServiceKey, async (req, res) => {
    try {
      const input = bodyOf(req);
      const mode = String(input.mode || "plan").trim().toLowerCase();
      if (!["plan", "dry_run"].includes(mode)) {
        return res.status(409).json({
          ok: false,
          error: {
            code: "runtime_breakglass_host_plan_read_only",
            message: "Host-internal Breakglass planning is read-only; apply is available only through the reviewed Admin workflow broker for Production or the local operator for Staging.",
          },
          workflow_dispatch_performed: false,
          database_connection_performed: false,
          database_mutation_performed: false,
          migration_apply_performed: false,
          grant_mutation_performed: false,
          secrets_included: false,
        });
      }
      return res.status(200).json(planBuilder(input, { env }));
    } catch (error) {
      return errorResponse(res, error, "RUNTIME_BREAKGLASS_HOST_PLAN_FAILED");
    }
  });

  return router;
}

export const _testingRuntimeBreakglassRoutes = {
  bodyOf,
  errorResponse,
  requireMiddleware,
  makeServiceKeyGuard,
  requestForReadback,
};
