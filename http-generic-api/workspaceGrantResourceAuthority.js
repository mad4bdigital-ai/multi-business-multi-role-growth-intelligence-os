const UNVERIFIABLE_RESOURCE_TYPES = new Set(["workflow", "agent"]);

function authorityError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function requireExactlyOne(rows, resourceType) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw authorityError(404, "workspace_resource_not_found", `${resourceType} resource was not found.`);
  }
  if (rows.length !== 1) {
    throw authorityError(409, "workspace_resource_ambiguous", `${resourceType} resource reference did not resolve uniquely.`);
  }
  const [resolved] = rows;
  return resolved;
}

function normalizeBrandRef(value) {
  return String(value || "").trim().replace(/^brand:/i, "").trim();
}

function requireTenantMatch(row, tenantId, resourceType) {
  if (String(row?.tenant_id || "") !== String(tenantId || "")) {
    throw authorityError(403, "workspace_resource_cross_tenant", `${resourceType} resource does not belong to this workspace.`);
  }
}

export async function assertGrantResourceInWorkspace(connection, { tenantId, resourceType, resourceRef }) {
  if (!connection || typeof connection.query !== "function") {
    throw authorityError(500, "workspace_resource_authority_unavailable", "Workspace resource authority connection is unavailable.");
  }

  if (UNVERIFIABLE_RESOURCE_TYPES.has(resourceType)) {
    throw authorityError(
      422,
      "workspace_resource_reference_unverifiable",
      `${resourceType} grants are fail-closed until a tenant-scoped canonical authority source exists.`
    );
  }

  if (resourceType === "workspace") {
    if (String(resourceRef) !== String(tenantId)) {
      throw authorityError(403, "workspace_resource_cross_tenant", "Workspace grant reference must match the requested workspace.");
    }
    const [rows] = await connection.query(
      "SELECT tenant_id, status FROM tenants WHERE tenant_id=? LIMIT 2 FOR UPDATE",
      [tenantId]
    );
    const tenant = requireExactlyOne(rows, "workspace");
    if (String(tenant.status || "").toLowerCase() !== "active") {
      throw authorityError(409, "workspace_resource_inactive", "Workspace is not active.");
    }
    return { resource_ref: String(tenant.tenant_id), authority_source: "tenants" };
  }

  if (resourceType === "app") {
    const [rows] = await connection.query(
      "SELECT app_id, tenant_id, status FROM developer_apps WHERE app_id=? LIMIT 2 FOR UPDATE",
      [resourceRef]
    );
    const app = requireExactlyOne(rows, "app");
    requireTenantMatch(app, tenantId, "app");
    if (String(app.status || "").toLowerCase() !== "active") {
      throw authorityError(409, "workspace_resource_inactive", "Only active developer apps can receive grants.");
    }
    return { resource_ref: String(app.app_id), authority_source: "developer_apps" };
  }

  if (resourceType === "site") {
    const [siteRows] = await connection.query(
      "SELECT site_id, platform_status FROM cms_sites WHERE site_id=? LIMIT 2 FOR UPDATE",
      [resourceRef]
    );
    const site = requireExactlyOne(siteRows, "site");
    if (String(site.platform_status || "").toLowerCase() !== "active") {
      throw authorityError(409, "workspace_resource_inactive", "Only active CMS sites can receive workspace grants.");
    }

    const [grantRows] = await connection.query(
      `SELECT grant_id, tenant_id, status,
              CASE WHEN expires_at IS NULL OR expires_at > NOW() THEN 1 ELSE 0 END AS not_expired
         FROM cms_site_access_grants
        WHERE site_id=? AND tenant_id=?
        LIMIT 20 FOR UPDATE`,
      [site.site_id, tenantId]
    );
    if (!Array.isArray(grantRows) || grantRows.length === 0) {
      throw authorityError(403, "workspace_resource_cross_tenant", "CMS site is not authorized for this workspace.");
    }
    const activeTenantRows = grantRows.filter(
      (row) => String(row.status || "").toLowerCase() === "active" && Number(row.not_expired) === 1
    );
    if (activeTenantRows.length === 0) {
      throw authorityError(409, "workspace_resource_inactive", "CMS site has no current active access grant for this workspace.");
    }
    return { resource_ref: String(site.site_id), authority_source: "cms_sites+cms_site_access_grants" };
  }

  if (resourceType === "asset") {
    const [rows] = await connection.query(
      "SELECT asset_id, tenant_id, lifecycle_status FROM workspace_assets WHERE asset_id=? LIMIT 2 FOR UPDATE",
      [resourceRef]
    );
    const asset = requireExactlyOne(rows, "asset");
    requireTenantMatch(asset, tenantId, "asset");
    if (String(asset.lifecycle_status || "").toLowerCase() === "deleted") {
      throw authorityError(409, "workspace_resource_inactive", "Deleted workspace assets cannot receive grants.");
    }
    return { resource_ref: String(asset.asset_id), authority_source: "workspace_assets" };
  }

  if (resourceType === "vault") {
    const [rows] = await connection.query(
      "SELECT vault_id, tenant_id, status FROM workspace_vaults WHERE vault_id=? LIMIT 2 FOR UPDATE",
      [resourceRef]
    );
    const vault = requireExactlyOne(rows, "vault");
    requireTenantMatch(vault, tenantId, "vault");
    if (String(vault.status || "").toLowerCase() !== "active") {
      throw authorityError(409, "workspace_resource_inactive", "Only active workspace vaults can receive grants.");
    }
    return { resource_ref: String(vault.vault_id), authority_source: "workspace_vaults" };
  }

  if (resourceType === "brand") {
    const normalizedRef = normalizeBrandRef(resourceRef);
    const [rows] = await connection.query(
      `SELECT tbl.tenant_id, tbl.brand_target_key, tbl.status AS link_status, b.status AS brand_status
         FROM tenant_brand_links tbl
         JOIN brands b ON LOWER(b.target_key) = LOWER(tbl.brand_target_key)
        WHERE LOWER(b.target_key) = LOWER(?)
           OR LOWER(COALESCE(b.normalized_brand_name, '')) = LOWER(?)
           OR LOWER(COALESCE(b.brand_name, '')) = LOWER(?)
        LIMIT 20 FOR UPDATE`,
      [normalizedRef, normalizedRef, normalizedRef]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw authorityError(404, "workspace_resource_not_found", "Brand resource was not found in tenant brand authority.");
    }
    const tenantRows = rows.filter((row) => String(row.tenant_id || "") === String(tenantId || ""));
    if (tenantRows.length === 0) {
      throw authorityError(403, "workspace_resource_cross_tenant", "Brand resource is not linked to this workspace.");
    }
    const activeRows = tenantRows.filter(
      (row) => String(row.link_status || "").toLowerCase() === "active" && String(row.brand_status || "").toLowerCase() === "active"
    );
    if (activeRows.length === 0) {
      throw authorityError(409, "workspace_resource_inactive", "Brand resource is not active for this workspace.");
    }
    if (activeRows.length !== 1) {
      throw authorityError(409, "workspace_resource_ambiguous", "Brand resource reference did not resolve uniquely for this workspace.");
    }
    return { resource_ref: String(activeRows[0].brand_target_key), authority_source: "tenant_brand_links" };
  }

  throw authorityError(422, "workspace_resource_reference_unverifiable", "Resource type has no canonical tenant-scoped authority resolver.");
}

export const _testingWorkspaceGrantResourceAuthority = {
  normalizeBrandRef,
  UNVERIFIABLE_RESOURCE_TYPES,
};
