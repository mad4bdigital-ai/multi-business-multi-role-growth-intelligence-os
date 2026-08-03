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

function isWorkspaceOwnerRole(role) {
  return OWNER_ROLES.has(String(role || "").trim().toLowerCase());
}

function normalizeBrandLookupRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^brand:/i, "").trim();
}

function brandLookupKeys(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeBrandLookupRef(raw);
  return [...new Set([raw, normalized].filter(Boolean))];
}

function brandRowKeys(row = {}) {
  return [row.target_key, row.normalized_brand_name, row.brand_name]
    .flatMap((value) => brandLookupKeys(value))
    .map((value) => value.toLowerCase());
}

function pickBrandRow(brandMap, brandRef) {
  for (const key of brandLookupKeys(brandRef).map((value) => value.toLowerCase())) {
    if (brandMap.has(key)) return brandMap.get(key);
  }
  return null;
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_resource_grant_create
  router.post("/me/workspaces/:tenant_id/resource-grants", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      const granteeUserId = String(req.body?.grantee_user_id || "").trim();
      const resourceType = normalizeResourceType(req.body?.resource_type);
      const resourceRef = normalizeResourceRef(req.body?.resource_ref || (resourceType === "workspace" ? req.params.tenant_id : ""));
      const permission = normalizePermission(req.body?.permission || "view");
      if (!granteeUserId) return res.status(400).json({ ok: false, error: { code: "grantee_user_id_required", message: "grantee_user_id is required." }, secrets_included: false });
      if (!resourceType) return res.status(400).json({ ok: false, error: { code: "invalid_resource_type", message: "Valid resource_type is required." }, secrets_included: false });
      if (!resourceRef) return res.status(400).json({ ok: false, error: { code: "resource_ref_required", message: "resource_ref is required." }, secrets_included: false });
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_resource_grant_create
      const [memberRows] = await connection.query("SELECT user_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' LIMIT 2 FOR UPDATE", [req.params.tenant_id, granteeUserId]);
      if (memberRows.length !== 1) throw Object.assign(new Error("Grantee must resolve exactly one active workspace membership."), { status: 403, code: "grantee_membership_required" });
      const candidateGrantId = randomUUID();
      await connection.query(
        `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'owner_assignment', ?, ?, ?)
         ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), granted_by=VALUES(granted_by), expires_at=VALUES(expires_at), metadata_json=VALUES(metadata_json), revoked_by=NULL, revoked_at=NULL, updated_at=NOW()`,
        [candidateGrantId, req.params.tenant_id, granteeUserId, resourceType, resourceRef, permission, req.auth.user_id, req.body?.expires_at || null, jsonMeta(req.body?.metadata_json)]
      );
      const [readbackRows] = await connection.query(
        "SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, expires_at, updated_at FROM workspace_resource_grants WHERE tenant_id=? AND grantee_user_id=? AND resource_type=? AND resource_ref=? AND permission=? AND status='active' ORDER BY updated_at DESC LIMIT 2",
        [req.params.tenant_id, granteeUserId, resourceType, resourceRef, permission]
      );
      if (readbackRows.length !== 1) throw Object.assign(new Error("Workspace resource grant readback must resolve exactly one active grant."), { status: 409, code: "workspace_resource_grant_create_readback_invalid" }); // MUTATION_READBACK: workspace_resource_grant_create
      const grant = readbackRows[0];
      await connection.commit();
      return res.status(201).json({ ok: true, tenant_id: grant.tenant_id, grant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_resource_grant_create_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_resource_grant_revoke
  router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_resource_grant_revoke
      const [lockedRows] = await connection.query("SELECT grant_id, tenant_id, status FROM workspace_resource_grants WHERE tenant_id=? AND grant_id=? LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.params.grant_id]);
      if (lockedRows.length !== 1) throw Object.assign(new Error("Workspace resource grant was not found."), { status: 404, code: "workspace_resource_grant_not_found" });
      if (lockedRows[0].status !== "active") throw Object.assign(new Error("Only active grants may be revoked."), { status: 409, code: "workspace_resource_grant_not_active" });
      const [result] = await connection.query("UPDATE workspace_resource_grants SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND grant_id=? AND status='active'", [req.auth.user_id, req.params.tenant_id, req.params.grant_id]);
      if (result.affectedRows !== 1) throw Object.assign(new Error("Workspace resource grant revoke lost its active state."), { status: 409, code: "workspace_resource_grant_state_changed" });
      const [readbackRows] = await connection.query("SELECT grant_id, tenant_id, status, revoked_by, revoked_at, updated_at FROM workspace_resource_grants WHERE tenant_id=? AND grant_id=? LIMIT 2", [req.params.tenant_id, req.params.grant_id]);
      if (readbackRows.length !== 1 || readbackRows[0].status !== "revoked") throw Object.assign(new Error("Workspace resource grant revoke readback did not reach revoked state."), { status: 409, code: "workspace_resource_grant_revoke_readback_invalid" }); // MUTATION_READBACK: workspace_resource_grant_revoke
      const grant = readbackRows[0];
      await connection.commit();
      return res.json({ ok: true, tenant_id: grant.tenant_id, grant_id: grant.grant_id, status: grant.status, revoked_by: grant.revoked_by, revoked_at: grant.revoked_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_resource_grant_revoke_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
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

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brands_list
  router.get("/me/workspaces/:tenant_id/brands", requireUserJwt, async (req, res) => {
    try {
      const membership = await requireActiveMembership(req, res, req.params.tenant_id);
      if (!membership) return;
      const ownerScoped = isWorkspaceOwnerRole(membership.role);
      const grantParams = [req.params.tenant_id];
      let grantUserClause = "";
      if (!ownerScoped) {
        grantUserClause = " AND grantee_user_id = ?";
        grantParams.push(req.auth.user_id);
      }

      const [grantRows] = await getPool().query(
        `SELECT grant_id, tenant_id, grantee_user_id, resource_ref, permission, grant_status, source, granted_at, expires_at, membership_role
           FROM v_workspace_resource_grant_effective
          WHERE tenant_id = ?
            AND resource_type = 'brand'
            ${grantUserClause}
          ORDER BY resource_ref, permission
          LIMIT 200`,
        grantParams
      );

      const [assetBrandRows] = await getPool().query(
        `SELECT DISTINCT brand_ref
           FROM workspace_assets
          WHERE tenant_id = ?
            AND lifecycle_status <> 'deleted'
            AND brand_ref IS NOT NULL
            AND TRIM(brand_ref) <> ''
          ORDER BY brand_ref
          LIMIT 200`,
        [req.params.tenant_id]
      );

      const lookupValues = [...new Set([
        ...grantRows.flatMap((row) => brandLookupKeys(row.resource_ref)),
        ...assetBrandRows.flatMap((row) => brandLookupKeys(row.brand_ref)),
      ])];
      let brandRows = [];
      if (lookupValues.length) {
        [brandRows] = await getPool().query(
          `SELECT brand_name, normalized_brand_name, brand_domain, target_key, base_url, status, brand_core_ready
             FROM brands
            WHERE target_key IN (?)
               OR normalized_brand_name IN (?)
               OR brand_name IN (?)
            LIMIT 200`,
          [lookupValues, lookupValues, lookupValues]
        );
      }

      const brandMap = new Map();
      for (const row of brandRows) {
        for (const key of brandRowKeys(row)) brandMap.set(key, row);
      }

      const brands = grantRows.map((grant) => {
        const meta = pickBrandRow(brandMap, grant.resource_ref);
        return {
          brand_ref: grant.resource_ref,
          display_name: meta?.brand_name || normalizeBrandLookupRef(grant.resource_ref) || grant.resource_ref,
          target_key: meta?.target_key || null,
          brand_domain: meta?.brand_domain || null,
          base_url: meta?.base_url || null,
          status: meta?.status || null,
          brand_core_ready: meta?.brand_core_ready || null,
          permission: grant.permission,
          permission_source: grant.source || "workspace_resource_grant",
          inherited_from_role: false,
          grantee_scope: grant.grantee_user_id === req.auth.user_id ? "self" : "workspace_member",
          granted_at: grant.granted_at,
        };
      });

      const grantedRefs = new Set(grantRows.flatMap((row) => brandLookupKeys(row.resource_ref).map((value) => value.toLowerCase())));
      const brandReferences = assetBrandRows
        .filter((row) => !brandLookupKeys(row.brand_ref).some((value) => grantedRefs.has(value.toLowerCase())))
        .map((row) => {
          const meta = pickBrandRow(brandMap, row.brand_ref);
          return {
            brand_ref: row.brand_ref,
            display_name: meta?.brand_name || normalizeBrandLookupRef(row.brand_ref) || row.brand_ref,
            target_key: meta?.target_key || null,
            evidence_source: "workspace_assets.brand_ref",
            claim_limit: "Visible asset context only; operations still require a brand or site grant.",
          };
        });

      return res.json({
        ok: true,
        tenant_id: req.params.tenant_id,
        membership: {
          role: membership.role,
          access_scope: ownerScoped ? "workspace_owner_admin" : "signed_in_user",
          inherited_permissions: ownerScoped ? ["workspace_resource_review"] : [],
        },
        authority: {
          primary_source: "v_workspace_resource_grant_effective",
          grants_scope: ownerScoped ? "workspace_visible_brand_grants" : "signed_in_user_brand_grants",
          diagnostic_counts_used_as_authority: false,
        },
        brands,
        brand_references: brandReferences,
        count: brands.length,
        reference_count: brandReferences.length,
        escalation_recommended: brands.length === 0 && brandReferences.length === 0,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_brands_list_failed", message: err.message }, secrets_included: false });
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
  isWorkspaceOwnerRole,
  normalizeBrandLookupRef,
  brandLookupKeys,
  OWNER_ROLES,
};
