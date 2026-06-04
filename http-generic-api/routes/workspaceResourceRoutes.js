import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id || null, is_admin: false };
  return next();
}

async function requireActiveMembership(req, res, tenantId) {
  const [rows] = await getPool().query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.tenant_id = ?
      LIMIT 1`,
    [req.auth.user_id, tenantId]
  );
  const membership = rows[0] || null;
  if (!membership || membership.status !== "active" || membership.tenant_status !== "active") {
    res.status(403).json({ ok: false, error: { code: "active_membership_required", message: "Active workspace membership required." }, secrets_included: false });
    return null;
  }
  return membership;
}

function optionalFilter(query, fieldName, value, params) {
  if (!value) return "";
  params.push(String(value));
  return ` AND ${fieldName} = ?`;
}

export function buildWorkspaceResourceRoutes() {
  const router = Router();

  router.get("/me/workspaces/:tenant_id/resource-grants", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const params = [req.params.tenant_id];
      let where = "tenant_id = ?";
      where += optionalFilter(req.query, "resource_type", req.query.resource_type, params);
      where += optionalFilter(req.query, "resource_ref", req.query.resource_ref, params);
      const [rows] = await getPool().query(
        `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, grant_status, source, granted_by, granted_at, expires_at
           FROM v_workspace_resource_grant_effective
          WHERE ${where}
          ORDER BY resource_type, resource_ref, permission
          LIMIT 200`,
        params
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, grants: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_resource_grants_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/workspaces/:tenant_id/assets", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const params = [req.params.tenant_id];
      let where = "tenant_id = ? AND lifecycle_status <> 'deleted'";
      where += optionalFilter(req.query, "asset_type", req.query.asset_type, params);
      where += optionalFilter(req.query, "brand_ref", req.query.brand_ref, params);
      where += optionalFilter(req.query, "site_ref", req.query.site_ref, params);
      const [rows] = await getPool().query(
        `SELECT asset_id, tenant_id, vault_id, asset_type, asset_ref, display_name, brand_ref, site_ref, workflow_ref, session_ref, visibility, lifecycle_status, created_by, created_at, updated_at
           FROM workspace_assets
          WHERE ${where}
          ORDER BY updated_at DESC
          LIMIT 200`,
        params
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, assets: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_assets_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/workspaces/:tenant_id/vaults", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const [rows] = await getPool().query(
        `SELECT vault_id, tenant_id, provider, provider_mode, vault_name, drive_id, root_folder_id, status, created_by, created_at, updated_at
           FROM workspace_vaults
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT 100`,
        [req.params.tenant_id]
      );
      return res.json({ ok: true, tenant_id: req.params.tenant_id, vaults: rows, count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_vaults_list_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}

export const _testingWorkspaceResourceRoutes = {
  optionalFilter,
};
