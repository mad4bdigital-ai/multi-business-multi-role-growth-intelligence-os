import { assertGrantResourceInWorkspace } from "./workspaceGrantResourceAuthority.js";

const BRAND_ASSET_MUTATION_PERMISSIONS = new Set(["owner", "admin", "manage", "operate", "edit"]);
const WORKSPACE_OWNER_ROLES = new Set(["owner", "admin"]);

function authorityError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export async function resolveWorkspaceAssetBrandRef(executor, {
  tenantId,
  actorId,
  brandRef,
}) {
  const requestedBrandRef = String(brandRef || "").trim();
  if (!requestedBrandRef) return null;
  if (!executor || typeof executor.query !== "function") {
    throw authorityError(500, "workspace_asset_brand_authority_unavailable", "Workspace asset Brand authority connection is unavailable.");
  }

  const resolved = await assertGrantResourceInWorkspace(executor, {
    tenantId,
    resourceType: "brand",
    resourceRef: requestedBrandRef,
  });
  const canonicalBrandRef = String(resolved.resource_ref || "").trim();
  if (!canonicalBrandRef) {
    throw authorityError(422, "workspace_asset_brand_reference_unverifiable", "Workspace asset Brand reference did not resolve canonically.");
  }

  if (String(actorId || "") === "platform_admin") return canonicalBrandRef;

  const [membershipRows] = await executor.query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, actorId]
  );
  if (!Array.isArray(membershipRows) || membershipRows.length !== 1) {
    throw authorityError(403, "workspace_asset_brand_membership_required", "Exactly one active workspace membership is required for Brand asset attachment.");
  }
  const [membership] = membershipRows;
  if (normalize(membership.status) !== "active" || normalize(membership.tenant_status) !== "active") {
    throw authorityError(403, "workspace_asset_brand_membership_required", "Active workspace membership is required for Brand asset attachment.");
  }
  if (WORKSPACE_OWNER_ROLES.has(normalize(membership.role))) return canonicalBrandRef;

  const [grantRows] = await executor.query(
    `SELECT grant_id, permission
       FROM v_workspace_resource_grant_effective
      WHERE tenant_id=?
        AND grantee_user_id=?
        AND resource_type='brand'
        AND LOWER(resource_ref)=LOWER(?)
      LIMIT 20`,
    [tenantId, actorId, canonicalBrandRef]
  );
  const authorized = Array.isArray(grantRows) && grantRows.some(
    (row) => BRAND_ASSET_MUTATION_PERMISSIONS.has(normalize(row.permission))
  );
  if (!authorized) {
    throw authorityError(403, "workspace_asset_brand_mutation_forbidden", "Brand edit or management authority is required to attach an asset to this Brand.");
  }
  return canonicalBrandRef;
}

export function assertWorkspaceAssetBrandPatchSafe(input = {}) {
  if (Object.prototype.hasOwnProperty.call(input, "brand_ref")) {
    throw authorityError(
      409,
      "workspace_asset_brand_rebind_requires_governed_surface",
      "Changing Brand attachment requires the governed Brand asset rebind lifecycle."
    );
  }
}

export const _testingWorkspaceAssetBrandAuthority = {
  BRAND_ASSET_MUTATION_PERMISSIONS,
  WORKSPACE_OWNER_ROLES,
  normalize,
};
