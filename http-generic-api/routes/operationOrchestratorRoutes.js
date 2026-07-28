import { Router } from "express";
import { getPool } from "../db.js";
import {
  diagnoseCi,
  executeOperation,
  getOperationStatus,
  previewOperation,
} from "../operationOrchestrator.js";
import { buildOperationContext } from "../operationContextService.js";
import {
  listOperationContracts,
  normalizeOperationKey,
} from "../operationContractRegistry.js";
import {
  assertOperationRunAccess,
  recordOperationRunOwnership,
} from "../operationRunOwnershipService.js";
import {
  listOperationGeneratedArtifacts,
  recordOperationGeneratedArtifacts,
} from "../operationGeneratedArtifactService.js";
import {
  finalizeOperationCapabilityLifecycle,
  prepareOperationCapabilityLifecycle,
} from "../operationCapabilityLifecycleService.js";
import {
  finalizeManagedGitWorkerLifecycle,
  markManagedGitWorkerRunning,
  prepareManagedGitWorkerLifecycle,
  readManagedGitWorkerLease,
} from "../managedGitWorkerLifecycleService.js";
import { collectChunkedToolResponse } from "../repositoryAutomationControlPlane.js";
import { dispatchToolForCaller, resolveCallerTypeForRequest } from "./gptToolsRoutes.js";

function bodyOf(req) {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
}

function requireSecurityMiddleware(name, middleware) {
  if (typeof middleware !== "function") {
    const error = new Error(`Operation routes require ${name}.`);
    error.code = "OPERATION_ROUTE_SECURITY_MIDDLEWARE_REQUIRED";
    throw error;
  }
  return middleware;
}

async function tenantMembership(userId, requestedTenantId = null) {
  const params = [userId];
  let tenantClause = "";
  if (requestedTenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(requestedTenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function requireTenantOperationPrincipal(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : null;
  if (!payload?.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "USER_JWT_REQUIRED", message: "Sign in required." },
      secrets_included: false,
    });
  }
  const membership = await tenantMembership(
    payload.user_id,
    payload.tenant_id || req.headers["x-tenant-id"] || null,
  );
  if (!membership) {
    return res.status(403).json({
      ok: false,
      error: {
        code: "ACTIVE_TENANT_MEMBERSHIP_REQUIRED",
        message: "No active tenant membership found.",
      },
      secrets_included: false,
    });
  }
  req.auth = {
    mode: "user_jwt",
    user_id: payload.user_id,
    tenant_id: membership.tenant_id,
    tenant_role: membership.role,
    is_admin: false,
  };
  return next();
}

function errorResponse(res, error, fallbackCode) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || fallbackCode,
      message: error?.message || "Operation request failed.",
      details: error?.details || null,
      requestId: res.req?.headers?.["x-request-id"] || null,
    },
    secrets_included: false,
  });
}

async function dispatchWithChunkCollection(dispatch, toolKey, args) {
  const initial = await dispatch(toolKey, args);
  return collectChunkedToolResponse(initial, { dispatch });
}

function depsFor(req) {
  const callerType = resolveCallerTypeForRequest(req);
  const dispatch = (toolKey, args) =>
    dispatchToolForCaller(callerType, toolKey, args, req);
  return {
    pool: getPool(),
    auth: req.auth || {},
    dispatch: (toolKey, args) =>
      dispatchWithChunkCollection(dispatch, toolKey, args),
  };
}

function isTenant(req) {
  return req.auth?.mode === "user_jwt" && req.auth?.is_admin !== true;
}

function isResumeOperation(input = {}) {
  return normalizeOperationKey(
    input.operation_key || input.operation || input.intent,
  ) === "operation.resume";
}

async function recordArtifactsSafely({ req, input, result, operationKey }) {
  try {
    return await recordOperationGeneratedArtifacts({
      pool: getPool(),
      auth: req.auth,
      input,
      result,
      operationKey,
    });
  } catch (error) {
    return {
      recorded: false,
      status: "unavailable",
      run_id: result?.run_id || result?.operation_id || null,
      artifact_count: 0,
      error: {
        code: error?.code || "OPERATION_ARTIFACT_REGISTRY_UNAVAILABLE",
        message:
          error?.message || "Generated artifact registration is unavailable.",
        details: error?.details || null,
      },
      retryable: Number(error?.status || 500) >= 500,
      secrets_included: false,
    };
  }
}

async function finalizeCapabilitySafely({ lifecycle, result }) {
  try {
    return await finalizeOperationCapabilityLifecycle({
      pool: getPool(),
      lifecycle,
      result,
    });
  } catch (error) {
    return {
      required: lifecycle?.required === true,
      status: "consume_failed",
      envelope_id: lifecycle?.envelope_id || null,
      error: {
        code: error?.code || "OPERATION_CAPABILITY_CONSUME_FAILED",
        message:
          error?.message || "Capability envelope consumption failed.",
        details: error?.details || null,
      },
      readback_required: true,
      retryable: false,
      secrets_included: false,
    };
  }
}

async function finalizeWorkerSafely({ lifecycle, result, dispatch }) {
  try {
    return await finalizeManagedGitWorkerLifecycle({
      pool: getPool(),
      lifecycle,
      result,
      dispatch,
    });
  } catch (error) {
    return {
      required: lifecycle?.required === true,
      status: "cleanup_failed",
      worker_id: lifecycle?.worker_id || null,
      workspace_released: false,
      error: {
        code: error?.code || "MANAGED_GIT_WORKER_CLEANUP_FAILED",
        message: error?.message || "Managed Git worker cleanup failed.",
        details: error?.details || null,
      },
      readback_required: true,
      retryable: Number(error?.status || 500) >= 500,
      secrets_included: false,
    };
  }
}

async function recordOwnershipSafely({ req, input, result, operationKey }) {
  try {
    return await recordOperationRunOwnership({
      pool: getPool(),
      auth: req.auth,
      input,
      result,
      operationKey,
    });
  } catch (error) {
    return {
      recorded: false,
      status: "unavailable",
      error: {
        code: error?.code || "OPERATION_OWNERSHIP_REGISTRY_UNAVAILABLE",
        message:
          error?.message || "Operation ownership registration is unavailable.",
        details: error?.details || null,
      },
      retryable: false,
      secrets_included: false,
    };
  }
}

function operationLifecycleNeedsAttention({
  workerResult,
  lifecycleResult,
  ownership,
  artifactRegistry,
}) {
  return workerResult?.status === "cleanup_failed"
    || lifecycleResult?.status === "consume_failed"
    || ownership?.status === "unavailable"
    || artifactRegistry?.status === "unavailable";
}

export function buildOperationOrchestratorRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
} = {}) {
  const router = Router();

  requireSecurityMiddleware(
    "requireBackendApiKey",
    requireBackendApiKey,
  );
  requireSecurityMiddleware(
    "requireAdminPrincipal",
    requireAdminPrincipal,
  );

  router.use(
    "/admin/operations",
    requireBackendApiKey,
    requireAdminPrincipal,
  );
  router.use(
    "/tenant/operations",
    requireTenantOperationPrincipal,
  );

  mountOperationRoutes(router, { prefix: "/admin" });
  mountOperationRoutes(router, { prefix: "/tenant" });

  return router;
}

function mountOperationRoutes(router, { prefix }) {
  router.get(`${prefix}/operations/contracts`, async (req, res) => {
    try {
      const scope =
        req.auth?.is_admin || req.auth?.mode === "backend_api"
          ? "admin"
          : "tenant";
      return res.status(200).json({
        ok: true,
        items: listOperationContracts({ principalScope: scope }),
        secrets_included: false,
      });
    } catch (error) {
      return errorResponse(res, error, "OPERATION_CONTRACT_LIST_FAILED");
    }
  });

  router.post(`${prefix}/operations/context`, async (req, res) => {
    try {
      return res.status(200).json(
        await buildOperationContext({
          auth: req.auth,
          input: bodyOf(req),
          pool: getPool(),
        }),
      );
    } catch (error) {
      return errorResponse(res, error, "OPERATION_CONTEXT_FAILED");
    }
  });

  router.post(`${prefix}/operations/preview`, async (req, res) => {
    try {
      return res
        .status(200)
        .json(await previewOperation(bodyOf(req), depsFor(req)));
    } catch (error) {
      return errorResponse(res, error, "OPERATION_PREVIEW_FAILED");
    }
  });

  router.post(`${prefix}/operations/execute`, async (req, res) => {
    let capabilityLifecycle = null;
    let capabilityFinalized = false;
    let workerLifecycle = null;
    let workerFinalized = false;
    let operationDeps = null;
    try {
      const requestedInput = bodyOf(req);
      if (isTenant(req) && isResumeOperation(requestedInput)) {
        await assertOperationRunAccess({
          pool: getPool(),
          auth: req.auth,
          runId: requestedInput.run_id,
        });
      }

      const operationKey = normalizeOperationKey(
        requestedInput.operation_key
          || requestedInput.operation
          || requestedInput.intent,
      );
      operationDeps = depsFor(req);
      capabilityLifecycle = await prepareOperationCapabilityLifecycle({
        pool: getPool(),
        auth: req.auth,
        input: requestedInput,
        operationKey,
      });
      const capabilityInput = capabilityLifecycle.input || requestedInput;
      workerLifecycle = await prepareManagedGitWorkerLifecycle({
        pool: getPool(),
        auth: req.auth,
        input: capabilityInput,
        operationKey,
        dispatch: operationDeps.dispatch,
      });
      workerLifecycle = await markManagedGitWorkerRunning({
        pool: getPool(),
        lifecycle: workerLifecycle,
      });
      const input = workerLifecycle.input || capabilityInput;
      const result = await executeOperation(input, operationDeps);
      const workerResult = await finalizeWorkerSafely({
        lifecycle: workerLifecycle,
        result,
        dispatch: operationDeps.dispatch,
      });
      workerFinalized = true;
      const lifecycleResult = await finalizeCapabilitySafely({
        lifecycle: capabilityLifecycle,
        result,
      });
      capabilityFinalized = true;
      const ownership = await recordOwnershipSafely({
        req,
        input,
        result,
        operationKey,
      });
      const artifactRegistry = await recordArtifactsSafely({
        req,
        input,
        result,
        operationKey,
      });
      const lifecycleNeedsAttention = operationLifecycleNeedsAttention({
        workerResult,
        lifecycleResult,
        ownership,
        artifactRegistry,
      });

      return res
        .status(
          lifecycleNeedsAttention
            ? 409
            : result?.status === "awaiting_input"
              ? 202
              : result?.ok === false
                ? 409
                : 200,
        )
        .json({
          ...result,
          ...(lifecycleNeedsAttention
            ? {
                ok: false,
                status: "completed_with_unresolved_lifecycle",
                retry_safe: false,
                operation_result: {
                  ok: result?.ok !== false,
                  status: result?.status || null,
                },
              }
            : {}),
          capability_lifecycle: lifecycleResult,
          managed_worker: workerResult,
          ownership,
          artifact_registry: artifactRegistry,
        });
    } catch (error) {
      const failureResult = {
        ok: false,
        status: "failed",
        error: {
          code: error?.code || "OPERATION_EXECUTION_FAILED",
          message: error?.message || "Operation execution failed.",
        },
      };
      const lifecycleDetails = {};

      if (
        workerLifecycle?.required === true
        && workerFinalized !== true
        && operationDeps?.dispatch
      ) {
        lifecycleDetails.managed_worker = await finalizeWorkerSafely({
          lifecycle: workerLifecycle,
          result: failureResult,
          dispatch: operationDeps.dispatch,
        });
      }

      if (capabilityLifecycle?.required === true && capabilityFinalized !== true) {
        lifecycleDetails.capability_lifecycle = await finalizeCapabilitySafely({
          lifecycle: capabilityLifecycle,
          result: failureResult,
        });
      }

      if (Object.keys(lifecycleDetails).length > 0) {
        error.details = {
          ...(error?.details && typeof error.details === "object"
            ? error.details
            : {}),
          ...lifecycleDetails,
        };
      }
      return errorResponse(res, error, "OPERATION_EXECUTION_FAILED");
    }
  });

  router.post(`${prefix}/operations/status`, async (req, res) => {
    try {
      const input = bodyOf(req);
      await assertOperationRunAccess({
        pool: getPool(),
        auth: req.auth,
        runId: input.run_id,
      });
      return res
        .status(200)
        .json(await getOperationStatus(input, depsFor(req)));
    } catch (error) {
      return errorResponse(res, error, "OPERATION_STATUS_FAILED");
    }
  });

  router.get(
    `${prefix}/operations/workers/:worker_id`,
    async (req, res) => {
      try {
        return res.status(200).json(
          await readManagedGitWorkerLease(
            { worker_id: req.params.worker_id },
            { pool: getPool(), auth: req.auth },
          ),
        );
      } catch (error) {
        return errorResponse(
          res,
          error,
          "MANAGED_GIT_WORKER_READ_FAILED",
        );
      }
    },
  );

  router.get(`${prefix}/operations/artifacts`, async (req, res) => {
    try {
      const input = {
        run_id: req.query.run_id,
        limit: req.query.limit,
        cursor: req.query.cursor,
        artifact_type: req.query.artifact_type,
      };
      await assertOperationRunAccess({
        pool: getPool(),
        auth: req.auth,
        runId: input.run_id,
      });
      return res.status(200).json(
        await listOperationGeneratedArtifacts(input, {
          pool: getPool(),
          auth: req.auth,
        }),
      );
    } catch (error) {
      return errorResponse(res, error, "OPERATION_ARTIFACT_LIST_FAILED");
    }
  });

  router.post(`${prefix}/operations/ci-diagnose`, async (req, res) => {
    try {
      return res
        .status(200)
        .json(await diagnoseCi(bodyOf(req), depsFor(req)));
    } catch (error) {
      return errorResponse(res, error, "CI_DIAGNOSIS_FAILED");
    }
  });
}

export const _testingOperationOrchestratorRoutes = {
  errorResponse,
  isResumeOperation,
  dispatchWithChunkCollection,
  recordArtifactsSafely,
  recordOwnershipSafely,
  finalizeCapabilitySafely,
  finalizeWorkerSafely,
  operationLifecycleNeedsAttention,
  requireSecurityMiddleware,
};
