const BRAND_READ_PERMISSIONS = new Set([
  "owner",
  "admin",
  "manage",
  "operate",
  "edit",
  "comment",
  "view",
]);
const WORKSPACE_OWNER_ROLES = new Set(["owner", "admin"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function denied(status, details = {}) {
  return {
    authorized: false,
    status,
    authority_source: null,
    canonical_brand_ref: details.canonical_brand_ref || null,
    membership: details.membership || null,
    workspace: details.workspace || null,
    resource_grant_present: false,
    grant_id: null,
    permission: null,
    secrets_included: false,
  };
}

export async function resolveWorkspaceBrandReadAuthority(executor, {
  tenantId,
  userId,
  brandRef,
  isAdmin = false,
} = {}) {
  if (!executor || typeof executor.query !== "function") {
    const error = new Error("Brand read authority SQL executor is unavailable.");
    error.code = "workspace_brand_read_authority_unavailable";
    error.status = 500;
    throw error;
  }

  const tenant = String(tenantId || "").trim();
  const user = String(userId || "").trim();
  const canonicalBrandRef = String(brandRef || "").trim();
  if (!canonicalBrandRef) return denied("brand_reference_required");

  if (isAdmin) {
    return {
      authorized: true,
      status: "admin_authorized",
      authority_source: "platform_admin",
      canonical_brand_ref: canonicalBrandRef,
      membership: null,
      workspace: null,
      resource_grant_present: true,
      grant_id: null,
      permission: "admin",
      secrets_included: false,
    };
  }
  if (!tenant || !user) {
    return denied("tenant_context_required", { canonical_brand_ref: canonicalBrandRef });
  }

  const [linkRowsRaw] = await executor.query(
    `SELECT link_id, tenant_id, brand_target_key, status
       FROM tenant_brand_links
      WHERE tenant_id=?
        AND BINARY brand_target_key <=> BINARY ?
      ORDER BY updated_at DESC, link_id ASC
      LIMIT 3`,
    [tenant, canonicalBrandRef]
  );
  const linkRows = Array.isArray(linkRowsRaw) ? linkRowsRaw : [];
  if (linkRows.length !== 1) {
    return denied(
      linkRows.length ? "tenant_brand_link_ambiguous" : "tenant_brand_link_missing",
      { canonical_brand_ref: canonicalBrandRef }
    );
  }
  const link = linkRows[0];
  if (normalize(link.status) !== "active") {
    return denied("tenant_brand_link_inactive", { canonical_brand_ref: canonicalBrandRef });
  }

  const [membershipRowsRaw] = await executor.query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=?
      LIMIT 2`,
    [tenant, user]
  );
  const membershipRows = Array.isArray(membershipRowsRaw) ? membershipRowsRaw : [];
  if (membershipRows.length !== 1) {
    return denied("workspace_membership_required", { canonical_brand_ref: canonicalBrandRef });
  }
  const membership = membershipRows[0];
  const publicMembership = { role: membership.role, status: membership.status };
  if (normalize(membership.status) !== "active" || normalize(membership.tenant_status) !== "active") {
    return denied("workspace_membership_required", {
      canonical_brand_ref: canonicalBrandRef,
      membership: publicMembership,
    });
  }

  const [workspaceRowsRaw] = await executor.query(
    `SELECT workspace_id, workspace_key, workspace_type, bootstrap_status, linked_brand_key
       FROM workspace_registry
      WHERE tenant_id=?
        AND workspace_type='brand'
        AND BINARY linked_brand_key <=> BINARY ?
      ORDER BY (bootstrap_status='ready') DESC, created_at ASC
      LIMIT 3`,
    [tenant, canonicalBrandRef]
  );
  const workspaceRows = Array.isArray(workspaceRowsRaw) ? workspaceRowsRaw : [];
  const readyWorkspaces = workspaceRows.filter((row) => normalize(row.bootstrap_status) === "ready");
  const workspace = readyWorkspaces.length === 1
    ? {
        workspace_id: readyWorkspaces[0].workspace_id,
        workspace_key: readyWorkspaces[0].workspace_key,
        workspace_type: readyWorkspaces[0].workspace_type,
        bootstrap_status: readyWorkspaces[0].bootstrap_status,
      }
    : null;

  if (WORKSPACE_OWNER_ROLES.has(normalize(membership.role))) {
    return {
      authorized: true,
      status: "tenant_brand_authorized",
      authority_source: "tenant_owner_membership",
      canonical_brand_ref: canonicalBrandRef,
      membership: publicMembership,
      workspace,
      resource_grant_present: false,
      grant_id: null,
      permission: membership.role,
      secrets_included: false,
    };
  }

  const [grantRowsRaw] = await executor.query(
    `SELECT grant_id, permission, grant_status, membership_status
       FROM v_workspace_resource_grant_effective
      WHERE tenant_id=?
        AND grantee_user_id=?
        AND resource_type='brand'
        AND BINARY resource_ref <=> BINARY ?
        AND membership_status='active'
        AND grant_status='active'
      ORDER BY grant_id ASC
      LIMIT 20`,
    [tenant, user, canonicalBrandRef]
  );
  const grantRows = Array.isArray(grantRowsRaw) ? grantRowsRaw : [];
  const grant = grantRows.find((row) => BRAND_READ_PERMISSIONS.has(normalize(row.permission))) || null;
  if (!grant) {
    return denied("tenant_brand_authority_missing", {
      canonical_brand_ref: canonicalBrandRef,
      membership: publicMembership,
      workspace,
    });
  }

  return {
    authorized: true,
    status: "tenant_brand_authorized",
    authority_source: "workspace_resource_grant",
    canonical_brand_ref: canonicalBrandRef,
    membership: publicMembership,
    workspace,
    resource_grant_present: true,
    grant_id: grant.grant_id || null,
    permission: grant.permission || null,
    secrets_included: false,
  };
}

export const _testingWorkspaceBrandReadAuthority = Object.freeze({
  BRAND_READ_PERMISSIONS,
  WORKSPACE_OWNER_ROLES,
  normalize,
});
