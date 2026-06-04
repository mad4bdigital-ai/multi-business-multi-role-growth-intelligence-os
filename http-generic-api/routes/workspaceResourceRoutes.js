import { Router } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const OWNER_ROLES = new Set(["owner", "admin"]);
const VALID_RESOURCE_TYPES = new Set(["workspace", "brand", "site", "app", "asset", "workflow", "agent", "vault"]);
const VALID_PERMISSIONS = new Set(["owner", "admin", "manage", "operate", "edit", "comment", "view"]);

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

async function requireWorkspaceOwner(req, res, tenantId) {
  const membership = await requireActiveMembership(req, res, tenantId);
  if (!membership) return null;
  if (!OWNER_ROLES.has(String(membership.role || "").toLowerCase())) {
    res.status(403).json({ ok: false, error: { code: "workspace_owner_required", message: "Workspace owner/admin role required." }, secrets_included: false });
    return null;
  }
  return membership;
}

function optionalFilter(query, fieldName, value, params) {
  if (!value) return "";
  params.push(String(value));
  return ` AND ${fieldName} = ?`;
}

function normalizeResourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_RESOURCE_TYPES.has(normalized) ? normalized : "";
}

function normalizePermission(value) {
  const normalized = String(value || "view").trim().toLowerCase();
  if (!VALID_PERMISSIONS.has(normalized)) return "view";
  return normalized === "owner" ? "admin" : normalized;
}

function normalizeResourceRef(value) {
  return String(value || "").trim();
}

function jsonMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.stringify(value);
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

  router.post("/me/workspaces/:tenant_id/resource-grants", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const granteeUserId = String(req.body?.grantee_user_id || "").trim();
      const resourceType = normalizeResourceType(req.body?.resource_type);
      const resourceRef = normalizeResourceRef(req.body?.resource_ref || (resourceType === "workspace" ? req.params.tenant_id : ""));
      const permission = normalizePermission(req.body?.permission || "view");
      if (!granteeUserId) return res.status(400).json({ ok: false, error: { code: "grantee_user_id_required", message: "grantee_user_id is required." }, secrets_included: false });
      if (!resourceType) return res.status(400).json({ ok: false, error: { code: "invalid_resource_type", message: "Valid resource_type is required." }, secrets_included: false });
      if (!resourceRef) return res.status(400).json({ ok: false, error: { code: "resource_ref_required", message: "resource_ref is required." }, secrets_included: false });
      const [memberRows] = await getPool().query(
        "SELECT user_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' LIMIT 1",
        [req.params.tenant_id, granteeUserId]
      );
      if (!memberRows[0]) return res.status(403).json({ ok: false, error: { code: "grantee_membership_required", message: "Grantee must be an active workspace member." }, secrets_included: false });
      const grantId = randomUUID();
      await getPool().query(
        `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'owner_assignment', ?, ?, ?)
         ON DUPLICATE KEY UPDATE status='active', granted_by=VALUES(granted_by), expires_at=VALUES(expires_at), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
        [grantId, req.params.tenant_id, granteeUserId, resourceType, resourceRef, permission, req.auth.user_id, req.body?.expires_at || null, jsonMeta(req.body?.metadata_json)]
      );
      return res.status(201).json({ ok: true, tenant_id: req.params.tenant_id, grant: { grant_id: grantId, grantee_user_id: granteeUserId, resource_type: resourceType, resource_ref: resourceRef, permission, status: "active" }, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_resource_grant_create_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke", requireUserJwt, async (req, res) => {
    try {
      const owner = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!owner) return;
      const [result] = await getPool().query(
        "UPDATE workspace_resource_grants SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND grant_id=? AND status='active'",
        [req.auth.user_id, req.params.tenant_id, req.params.grant_id]
      );
      return res.status(result.affectedRows ? 200 : 404).json({ ok: Boolean(result.affectedRows), tenant_id: req.params.tenant_id, grant_id: req.params.grant_id, status: result.affectedRows ? "revoked" : "not_found", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_resource_grant_revoke_failed", message: err.message }, secrets_included: false });
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
  normalizeResourceType,
  normalizePermission,
  normalizeResourceRef,
  OWNER_ROLES,
};
