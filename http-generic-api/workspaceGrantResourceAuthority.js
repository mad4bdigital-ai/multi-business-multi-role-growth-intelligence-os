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

function activeValue(value) {
  return new Set(["active", "enabled", "true", "1", "yes"]).has(String(value ?? "").trim().toLowerCase());
}

function uniqueRefs(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function requireExplicitTenantResourceBinding(connection, {
  tenantId,
  dimension,
  resourceType,
  resourceRefs,
}) {
  const refs = uniqueRefs(resourceRefs);
  if (refs.length === 0) {
    throw authorityError(422, "workspace_resource_reference_unverifiable", `${resourceType} resource has no canonical binding reference.`);
  }
  const placeholders = refs.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT crb.binding_id, crb.resource_ref, crb.effect, crb.status,
            c.container_id, c.status AS container_status,
            d.dimension_key, d.status AS dimension_status
       FROM container_resource_bindings crb
       JOIN containers c
         ON c.container_id = crb.container_id
        AND c.tenant_id = crb.tenant_id
       JOIN container_resource_dimension_registry d
         ON d.dimension_key = crb.dimension_key
      WHERE crb.tenant_id = ?
        AND crb.dimension_key = ?
        AND crb.resource_type = ?
        AND crb.resource_ref IN (${placeholders})
        AND crb.status = 'active'
        AND c.status = 'active'
        AND d.status = 'active'
        AND crb.effect = 'allow'
        AND (crb.valid_from IS NULL OR crb.valid_from <= UTC_TIMESTAMP())
        AND (crb.valid_until IS NULL OR crb.valid_until > UTC_TIMESTAMP())
      LIMIT 20 FOR UPDATE`,
    [tenantId, dimension, resourceType, ...refs]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw authorityError(
      422,
      "workspace_resource_reference_unverifiable",
      `${resourceType} resource has no current explicit direct tenant authority binding.`
    );
  }
  return rows;
}

async function resolveCanonicalBrandForWorkspace(connection, { tenantId, resourceRef }) {
  const normalizedRef = normalizeBrandRef(resourceRef);
  const [brandRows] = await connection.query(
    `SELECT b.target_key, b.status AS brand_status
       FROM brands b
      WHERE LOWER(b.target_key) = LOWER(?)
         OR LOWER(COALESCE(b.normalized_brand_name, '')) = LOWER(?)
         OR LOWER(COALESCE(b.brand_name, '')) = LOWER(?)
      LIMIT 20 FOR UPDATE`,
    [normalizedRef, normalizedRef, normalizedRef]
  );
  const brand = requireExactlyOne(brandRows, "brand");
  if (String(brand.brand_status || "").toLowerCase() !== "active") {
    throw authorityError(409, "workspace_resource_inactive", "Brand resource is not active.");
  }

  const canonicalBrandRef = String(brand.target_key || "").trim();
  if (!canonicalBrandRef) {
    throw authorityError(422, "workspace_resource_reference_unverifiable", "Brand resource has no canonical target key.");
  }

  // Keep legacy `brands` and tenant authority identity comparisons collation-local.
  // `brands` may use utf8mb4_unicode_ci while tenant_brand_links uses
  // utf8mb4_uca1400_ai_ci. Comparing those columns in one SQL JOIN causes
  // ER_CANT_AGGREGATE_2COLLATIONS on valid tenant Brand operations.
  const [linkRows] = await connection.query(
    `SELECT tbl.tenant_id, tbl.brand_target_key, tbl.status AS link_status
       FROM tenant_brand_links tbl
      WHERE LOWER(tbl.brand_target_key) = LOWER(?)
      LIMIT 20 FOR UPDATE`,
    [canonicalBrandRef]
  );
  if (!Array.isArray(linkRows) || linkRows.length === 0) {
    throw authorityError(404, "workspace_resource_not_found", "Brand resource was not found in tenant brand authority.");
  }

  const tenantRows = linkRows.filter((row) => String(row.tenant_id || "") === String(tenantId || ""));
  if (tenantRows.length === 0) {
    throw authorityError(403, "workspace_resource_cross_tenant", "Brand resource is not linked to this workspace.");
  }
  const activeRows = tenantRows.filter((row) => String(row.link_status || "").toLowerCase() === "active");
  if (activeRows.length === 0) {
    throw authorityError(409, "workspace_resource_inactive", "Brand resource is not active for this workspace.");
  }
  if (activeRows.length !== 1) {
    throw authorityError(409, "workspace_resource_ambiguous", "Brand resource reference did not resolve uniquely for this workspace.");
  }
  return {
    resource_ref: String(activeRows[0].brand_target_key),
    authority_source: "brands+tenant_brand_links",
  };
}

export async function assertGrantResourceInWorkspace(connection, { tenantId, resourceType, resourceRef }) {
  if (!connection || typeof connection.query !== "function") {
    throw authorityError(500, "workspace_resource_authority_unavailable", "Workspace resource authority connection is unavailable.");
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

  if (resourceType === "agent") {
    const [rows] = await connection.query(
      "SELECT agent_id, status, health_status FROM agents WHERE agent_id=? LIMIT 2 FOR UPDATE",
      [resourceRef]
    );
    const agent = requireExactlyOne(rows, "agent");
    if (String(agent.status || "").toLowerCase() !== "active") {
      throw authorityError(409, "workspace_resource_inactive", "Only active canonical agents can receive workspace grants.");
    }
    await requireExplicitTenantResourceBinding(connection, {
      tenantId,
      dimension: "agents",
      resourceType: "agent",
      resourceRefs: [agent.agent_id],
    });
    return { resource_ref: String(agent.agent_id), authority_source: "agents+container_resource_bindings" };
  }

  if (resourceType === "workflow") {
    const [rows] = await connection.query(
      `SELECT workflow_id, workflow_key, status, active
         FROM workflows
        WHERE workflow_id=? OR workflow_key=?
        LIMIT 3 FOR UPDATE`,
      [resourceRef, resourceRef]
    );
    const workflow = requireExactlyOne(rows, "workflow");
    if (!activeValue(workflow.active) && !activeValue(workflow.status)) {
      throw authorityError(409, "workspace_resource_inactive", "Only active canonical workflows can receive workspace grants.");
    }
    const canonicalWorkflowRef = String(workflow.workflow_key || workflow.workflow_id);
    await requireExplicitTenantResourceBinding(connection, {
      tenantId,
      dimension: "workflows",
      resourceType: "workflow",
      resourceRefs: [canonicalWorkflowRef, workflow.workflow_id],
    });
    return { resource_ref: canonicalWorkflowRef, authority_source: "workflows+container_resource_bindings" };
  }

  if (resourceType === "brand") {
    return resolveCanonicalBrandForWorkspace(connection, { tenantId, resourceRef });
  }

  throw authorityError(422, "workspace_resource_reference_unverifiable", "Resource type has no canonical tenant-scoped authority resolver.");
}

export const _testingWorkspaceGrantResourceAuthority = {
  normalizeBrandRef,
  activeValue,
  uniqueRefs,
  resolveCanonicalBrandForWorkspace,
};
