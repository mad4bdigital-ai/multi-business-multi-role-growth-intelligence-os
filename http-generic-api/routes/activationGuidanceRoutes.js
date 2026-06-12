import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { buildActivationGuidance } from "../activationGuidanceService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchActiveMembershipForTenant({ userId, tenantId = null }) {
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function requireTenantUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt"
    ? req.auth
    : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || req.query.tenant_id || null;
  const membership = await fetchActiveMembershipForTenant({ userId: payload.user_id, tenantId: requestedTenantId });
  if (!membership) {
    return res.status(403).json({ ok: false, error: { code: "active_tenant_membership_required", message: "No active tenant membership found for this user." }, secrets_included: false });
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

export function buildActivationGuidanceRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/tenant/activation/guidance", requireTenantUserJwt, async (req, res, next) => {
    try {
      const guidance = await buildActivationGuidance({
        profile: "tenant",
        userId: req.auth.user_id,
        tenantId: req.auth.tenant_id,
      });
      res.status(200).json({ ...guidance, auth_context: { tenant_id: req.auth.tenant_id, user_id: req.auth.user_id, tenant_role: req.auth.tenant_role, source: "user_jwt" }, tenant_facing: true, secrets_included: false });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/activation/guidance", ...adminGuards, async (req, res, next) => {
    try {
      const guidance = await buildActivationGuidance({
        profile: "admin",
        userId: req.query.user_id || req.auth?.user_id || null,
        tenantId: req.query.tenant_id || null,
      });
      res.status(200).json({ ...guidance, admin_facing: true, secrets_included: false });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const _testingActivationGuidanceRoutes = { verifyUserJwt };
