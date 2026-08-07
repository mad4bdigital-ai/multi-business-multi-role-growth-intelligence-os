import { Router } from "express";
import { getPool } from "../db.js";
import { getOperationObservabilityDashboard } from "../operationObservabilityService.js";


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

async function requireTenantObservabilityPrincipal(req, res, next) {
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

function errorResponse(res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "OPERATION_OBSERVABILITY_FAILED",
      message: error?.message || "Operation observability request failed.",
      details: error?.details || null,
      requestId: res.req?.headers?.["x-request-id"] || null,
    },
    secrets_included: false,
  });
}

async function dashboardHandler(req, res) {
  try {
    return res.status(200).json(await getOperationObservabilityDashboard({
      hours: req.query.hours,
      sample_limit: req.query.sample_limit,
    }, {
      pool: getPool(),
      auth: req.auth,
    }));
  } catch (error) {
    return errorResponse(res, error);
  }
}

export function buildOperationObservabilityRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
} = {}) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);
  const requireTenant = [requireBackendApiKey, requireTenantObservabilityPrincipal].filter(Boolean);

  router.get(
    "/admin/operations/observability",
    ...requireAdmin,
    dashboardHandler,
  );
  router.get(
    "/tenant/operations/observability",
    ...requireTenant,
    dashboardHandler,
  );

  return router;
}

export const _testingOperationObservabilityRoutes = {
  errorResponse,
};