import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { listTypedCatalogs, queryTypedCatalog } from "../typedCatalogService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
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
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function requireTenantCatalogPrincipal(req, res, next) {
  const payload = req.auth?.mode === "user_jwt"
    ? req.auth
    : verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "USER_JWT_REQUIRED", message: "Sign in required.", details: null, requestId: req.headers["x-request-id"] || null },
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
      error: { code: "ACTIVE_TENANT_MEMBERSHIP_REQUIRED", message: "No active tenant membership found.", details: null, requestId: req.headers["x-request-id"] || null },
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

function errorResponse(res, req, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "CATALOG_REQUEST_FAILED",
      message: error?.message || "Typed catalog request failed.",
      details: error?.details || null,
      requestId: req.headers["x-request-id"] || null,
    },
    secrets_included: false,
  });
}

function inputOf(req) {
  return {
    catalog_key: req.query.catalog_key || req.query.catalog || null,
    limit: req.query.limit,
    cursor: req.query.cursor,
    q: req.query.q || req.query.filter || null,
  };
}

function mountCatalogRoutes(router, middleware = []) {
  router.get("/operation-catalogs", ...middleware, async (req, res) => {
    try {
      if (!req.query.catalog_key && !req.query.catalog) {
        return res.status(200).json(listTypedCatalogs({ auth: req.auth }));
      }
      return res.status(200).json(await queryTypedCatalog(inputOf(req), {
        auth: req.auth,
        pool: getPool(),
      }));
    } catch (error) {
      return errorResponse(res, req, error);
    }
  });
}

export function buildTypedCatalogRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();

  const admin = Router();
  mountCatalogRoutes(admin, [requireBackendApiKey, requireAdminPrincipal].filter(Boolean));
  router.use("/admin", admin);

  const tenant = Router();
  mountCatalogRoutes(tenant, [requireTenantCatalogPrincipal]);
  router.use("/tenant", tenant);

  return router;
}

export const _testingTypedCatalogRoutes = {
  verifyUserJwt,
  inputOf,
  errorResponse,
};
