import { Router } from "express";
import jwt from "jsonwebtoken";
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
import { dispatchToolForCaller, resolveCallerTypeForRequest } from "./gptToolsRoutes.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function bodyOf(req) {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
}

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return null; }
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
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id) {
    return res.status(401).json({ ok: false, error: { code: "USER_JWT_REQUIRED", message: "Sign in required." }, secrets_included: false });
  }
  const membership = await tenantMembership(payload.user_id, payload.tenant_id || req.headers["x-tenant-id"] || null);
  if (!membership) {
    return res.status(403).json({ ok: false, error: { code: "ACTIVE_TENANT_MEMBERSHIP_REQUIRED", message: "No active tenant membership found." }, secrets_included: false });
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

function depsFor(req) {
  const callerType = resolveCallerTypeForRequest(req);
  return {
    pool: getPool(),
    auth: req.auth || {},
    dispatch: (toolKey, args) => dispatchToolForCaller(callerType, toolKey, args, req),
  };
}

function isTenant(req) {
  return req.auth?.mode === "user_jwt" && req.auth?.is_admin !== true;
}

function isResumeOperation(input = {}) {
  return normalizeOperationKey(input.operation_key || input.operation || input.intent) === "operation.resume";
}

function mountOperationRoutes(router, middleware = []) {
  router.get("/operations/contracts", ...middleware, async (req, res) => {
    try {
      const scope = req.auth?.is_admin || req.auth?.mode === "backend_api" ? "admin" : "tenant";
      return res.status(200).json({ ok: true, items: listOperationContracts({ principalScope: scope }), secrets_included: false });
    } catch (error) { return errorResponse(res, error, "OPERATION_CONTRACT_LIST_FAILED"); }
  });

  router.post("/operations/context", ...middleware, async (req, res) => {
    try {
      return res.status(200).json(await buildOperationContext({ auth: req.auth, input: bodyOf(req), pool: getPool() }));
    } catch (error) { return errorResponse(res, error, "OPERATION_CONTEXT_FAILED"); }
  });

  router.post("/operations/preview", ...middleware, async (req, res) => {
    try { return res.status(200).json(await previewOperation(bodyOf(req), depsFor(req))); }
    catch (error) { return errorResponse(res, error, "OPERATION_PREVIEW_FAILED"); }
  });

  router.post("/operations/execute", ...middleware, async (req, res) => {
    try {
      const input = bodyOf(req);
      if (isTenant(req) && isResumeOperation(input)) {
        await assertOperationRunAccess({ pool: getPool(), auth: req.auth, runId: input.run_id });
      }
      const result = await executeOperation(input, depsFor(req));
      const ownership = await recordOperationRunOwnership({
        pool: getPool(),
        auth: req.auth,
        input,
        result,
        operationKey: normalizeOperationKey(input.operation_key || input.operation || input.intent),
      });
      return res.status(result?.status === "awaiting_input" ? 202 : result?.ok === false ? 409 : 200).json({
        ...result,
        ownership,
      });
    } catch (error) { return errorResponse(res, error, "OPERATION_EXECUTION_FAILED"); }
  });

  router.post("/operations/status", ...middleware, async (req, res) => {
    try {
      const input = bodyOf(req);
      await assertOperationRunAccess({ pool: getPool(), auth: req.auth, runId: input.run_id });
      return res.status(200).json(await getOperationStatus(input, depsFor(req)));
    } catch (error) { return errorResponse(res, error, "OPERATION_STATUS_FAILED"); }
  });

  router.post("/operations/ci-diagnose", ...middleware, async (req, res) => {
    try { return res.status(200).json(await diagnoseCi(bodyOf(req), depsFor(req))); }
    catch (error) { return errorResponse(res, error, "CI_DIAGNOSIS_FAILED"); }
  });
}

export function buildOperationOrchestratorRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();

  const admin = Router();
  mountOperationRoutes(admin, [requireBackendApiKey, requireAdminPrincipal].filter(Boolean));
  router.use("/admin", admin);

  const tenant = Router();
  mountOperationRoutes(tenant, [requireTenantOperationPrincipal]);
  router.use("/tenant", tenant);

  return router;
}

export const _testingOperationOrchestratorRoutes = {
  verifyUserJwt,
  errorResponse,
  isResumeOperation,
};
