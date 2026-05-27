import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

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
  const pool = getPool();
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await pool.query(
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
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
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

function nonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function boundedInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

async function resolveAllowedEvolutionScope(req) {
  const pool = getPool();
  const explicitScope = nonEmptyString(req.query.scope_key || req.query.scopeKey);
  const brandKey = nonEmptyString(req.query.brand_key || req.query.brandKey);
  const params = [req.auth.tenant_id, req.auth.user_id];
  const where = ["tenant_id = ?", "user_id = ?", "access_state = 'allowed'"];

  if (explicitScope) {
    where.push("scope_key = ?");
    params.push(explicitScope);
  } else if (brandKey) {
    where.push("brand_key = ?");
    params.push(brandKey);
  }

  const [rows] = await pool.query(
    `SELECT scope_key, tenant_id, brand_key, user_id, email, membership_role, assigned_role, access_state
       FROM v_platform_evolution_scope_access
      WHERE ${where.join(" AND ")}
      ORDER BY brand_key ASC
      LIMIT 1`,
    params
  );

  const scope = rows[0] || null;
  if (!scope) {
    const err = new Error("No allowed Platform Evolution checkpoint scope found for this tenant user.");
    err.status = 403;
    err.code = "platform_evolution_scope_not_granted";
    throw err;
  }
  return scope;
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
    secrets_included: false,
  });
}

export function buildTenantEvolutionRoutes() {
  const router = Router();

  router.get("/tenant/evolution/activation-card", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_activation_card WHERE scope_key = ? LIMIT 1`,
        [scope.scope_key]
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        card: rows[0] || null,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        access: scope,
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_activation_card_failed"); }
  });

  router.get("/tenant/evolution/thread-map", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const status = nonEmptyString(req.query.status);
      const priority = nonEmptyString(req.query.priority);
      const limit = boundedInt(req.query.limit, 50, 1, 100);
      const where = ["scope_key = ?"];
      const params = [scope.scope_key];
      if (status) { where.push("status = ?"); params.push(status); }
      if (priority) { where.push("priority = ?"); params.push(priority); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_thread_map WHERE ${where.join(" AND ")} ORDER BY FIELD(priority,'critical','high','medium','low'), thread_key LIMIT ?`,
        params
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        count: rows.length,
        threads: rows,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_thread_map_failed"); }
  });

  router.get("/tenant/evolution/open-evidence", requireTenantUserJwt, async (req, res) => {
    try {
      const scope = await resolveAllowedEvolutionScope(req);
      const threadKey = nonEmptyString(req.query.thread_key || req.query.threadKey);
      const linkedSurface = nonEmptyString(req.query.linked_surface || req.query.linkedSurface);
      const limit = boundedInt(req.query.limit, 50, 1, 100);
      const where = ["scope_key = ?"];
      const params = [scope.scope_key];
      if (threadKey) { where.push("thread_key = ?"); params.push(threadKey); }
      if (linkedSurface) { where.push("linked_surface = ?"); params.push(linkedSurface); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_open_evidence WHERE ${where.join(" AND ")} ORDER BY FIELD(linked_priority,'critical','high','medium','low'), linked_updated_at DESC LIMIT ?`,
        params
      );
      return res.status(200).json({
        ok: true,
        scope_key: scope.scope_key,
        count: rows.length,
        evidence: rows,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_evolution_open_evidence_failed"); }
  });

  return router;
}

export const _testingTenantEvolutionRoutes = {
  verifyUserJwt,
  boundedInt,
  nonEmptyString,
};
