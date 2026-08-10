function compact(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function denied(reason, denialCode, details = {}) {
  return Object.freeze({
    ok: false,
    reason,
    denial_code: denialCode,
    credential_scope: null,
    credential_scope_provenance: null,
    workspace_ownership_type: null,
    owner_scope_type: null,
    owner_scope_ref: null,
    connections: [],
    row_count: 0,
    brand_connections_included: false,
    secrets_included: false,
    ...details,
  });
}

const WORKSPACE_OWNERSHIP_SQL = `
  SELECT
    workspace_id,
    tenant_id,
    workspace_type,
    workspace_ownership_type,
    owner_user_id,
    linked_brand_key,
    bootstrap_status,
    ownership_revision
    FROM workspace_registry
   WHERE tenant_id = ?
     AND workspace_id = ?
   ORDER BY workspace_id ASC
   LIMIT 2
`;

const BRAND_TENANT_MEMBERSHIP_SQL = `
  SELECT user_id, tenant_id, role, status
    FROM memberships
   WHERE tenant_id = ?
     AND user_id = ?
     AND status = 'active'
   ORDER BY updated_at DESC
   LIMIT 2
`;

const BRAND_RESOURCE_GRANT_SQL = `
  SELECT grant_id, tenant_id, grantee_user_id, resource_ref, permission, grant_status, membership_role
    FROM v_workspace_resource_grant_effective
   WHERE tenant_id = ?
     AND grantee_user_id = ?
     AND resource_type = 'brand'
     AND BINARY resource_ref <=> BINARY ?
   ORDER BY permission ASC, grant_id ASC
   LIMIT 20
`;

const OWNERSHIP_SCOPED_CONNECTION_SQL = `
  SELECT DISTINCT
    c.connection_id,
    c.tenant_id,
    c.app_key,
    c.auth_type,
    c.status,
    c.validation_status,
    c.last_validated_at,
    c.last_used_at,
    c.is_primary,
    v.workspace_id,
    v.owner_scope_type,
    v.owner_scope_ref,
    v.brand_id,
    v.ownership_status,
    v.ownership_resolution_status
  FROM v_context_kernel_connection_ownership_compatibility v
  INNER JOIN user_app_connections c
    ON BINARY c.connection_id <=> BINARY v.connection_id
   AND BINARY c.tenant_id <=> BINARY v.tenant_id
   AND BINARY c.app_key <=> BINARY v.provider_key
  WHERE v.tenant_id = ?
    AND v.workspace_id = ?
    AND v.provider_key = ?
    AND v.owner_scope_type = ?
    AND v.owner_scope_ref = ?
    AND v.brand_id IS NULL
    AND v.link_status = 'active'
    AND v.ownership_status = 'active'
    AND v.ownership_resolution_status = 'classified'
    AND (? <> 'personal_workspace' OR BINARY v.connection_owner_user_id <=> BINARY ?)
  ORDER BY c.is_primary DESC, c.last_validated_at DESC, c.connection_id ASC
  LIMIT 3
`;

const BRAND_OWNERSHIP_SCOPED_CONNECTION_SQL = `
  SELECT DISTINCT
    c.connection_id,
    c.tenant_id,
    c.app_key,
    c.auth_type,
    c.status,
    c.validation_status,
    c.last_validated_at,
    c.last_used_at,
    c.is_primary,
    v.workspace_id,
    v.owner_scope_type,
    v.owner_scope_ref,
    v.brand_id,
    v.ownership_status,
    v.ownership_resolution_status
  FROM v_context_kernel_connection_ownership_compatibility v
  INNER JOIN user_app_connections c
    ON BINARY c.connection_id <=> BINARY v.connection_id
   AND BINARY c.tenant_id <=> BINARY v.tenant_id
   AND BINARY c.app_key <=> BINARY v.provider_key
  WHERE v.tenant_id = ?
    AND v.workspace_id = ?
    AND v.provider_key = ?
    AND v.owner_scope_type = 'brand'
    AND BINARY v.owner_scope_ref <=> BINARY ?
    AND BINARY v.brand_id <=> BINARY ?
    AND v.link_status = 'active'
    AND v.ownership_status = 'active'
    AND v.ownership_resolution_status = 'classified'
  ORDER BY c.is_primary DESC, c.last_validated_at DESC, c.connection_id ASC
  LIMIT 3
`;

const BRAND_OWNER_ROLES = new Set(["owner", "admin"]);
const BRAND_CONNECTION_USE_PERMISSIONS = new Set(["owner", "admin", "manage", "operate"]);

export const PlatformPluginConnectionOwnershipDenialCode = Object.freeze({
  WORKSPACE_REQUIRED: "CONNECTION_WORKSPACE_REQUIRED",
  SCOPE_DENIED: "CONNECTION_OWNERSHIP_SCOPE_DENIED",
  SCOPE_MISMATCH: "CONNECTION_OWNERSHIP_SCOPE_MISMATCH",
  BRAND_AUTHORITY_REQUIRED: "BRAND_CONNECTION_AUTHORITY_REQUIRED",
  PROVENANCE_INVALID: "CONNECTION_CREDENTIAL_SCOPE_PROVENANCE_INVALID",
});

async function resolveBrandConnectionUseAuthority({ pool, tenant, user, brandRef }) {
  const [membershipRowsRaw] = await pool.query(BRAND_TENANT_MEMBERSHIP_SQL, [tenant, user]);
  const membershipRows = Array.isArray(membershipRowsRaw) ? membershipRowsRaw : [];
  if (membershipRows.length !== 1) {
    return Object.freeze({ allowed: false, source: "membership", grant_id: null, permission: null, secrets_included: false });
  }
  const membershipRole = compact(membershipRows[0]?.role, 32).toLowerCase();
  if (BRAND_OWNER_ROLES.has(membershipRole)) {
    return Object.freeze({
      allowed: true,
      source: "tenant_owner_membership",
      grant_id: null,
      permission: membershipRole,
      secrets_included: false,
    });
  }

  const [grantRowsRaw] = await pool.query(BRAND_RESOURCE_GRANT_SQL, [tenant, user, brandRef]);
  const grantRows = Array.isArray(grantRowsRaw) ? grantRowsRaw : [];
  const grant = grantRows.find((row) => BRAND_CONNECTION_USE_PERMISSIONS.has(
    compact(row?.permission, 32).toLowerCase(),
  )) || null;
  return Object.freeze({
    allowed: Boolean(grant),
    source: grant ? "workspace_resource_grant" : "brand_grant_missing",
    grant_id: grant?.grant_id || null,
    permission: grant?.permission || null,
    secrets_included: false,
  });
}

function buildCredentialScopeProvenance({
  tenant,
  workspace,
  plugin,
  user,
  ownershipType,
  ownerScopeType,
  ownerScopeRef,
  credentialScope,
  ownershipRevision,
  requestedBrandRef,
  brandAuthority,
}) {
  return Object.freeze({
    schema_version: "connection-credential-scope-provenance-v1",
    source: "v_context_kernel_connection_ownership_compatibility",
    tenant_id: tenant,
    workspace_id: workspace,
    provider_key: plugin,
    credential_scope: credentialScope,
    workspace_ownership_type: ownershipType,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: ownerScopeRef,
    ownership_revision: Number(ownershipRevision || 0),
    subject_user_id: credentialScope === "user_connection" ? user : null,
    brand_ref: requestedBrandRef,
    brand_authority_source: brandAuthority?.source || null,
    brand_authority_grant_id: brandAuthority?.grant_id || null,
    brand_authority_permission: brandAuthority?.permission || null,
    ownership_resolution_required: true,
    ownership_resolution_status: "classified",
    secrets_included: false,
  });
}

function rowMatchesProvenance(row, provenance) {
  if (!row || !provenance) return false;
  if (compact(row.workspace_id, 64) !== compact(provenance.workspace_id, 64)) return false;
  if (compact(row.owner_scope_type, 64) !== compact(provenance.owner_scope_type, 64)) return false;
  if (compact(row.owner_scope_ref, 191) !== compact(provenance.owner_scope_ref, 191)) return false;
  if (compact(row.ownership_status, 32).toLowerCase() !== "active") return false;
  if (compact(row.ownership_resolution_status, 32).toLowerCase() !== "classified") return false;
  if (provenance.owner_scope_type === "brand" && compact(row.brand_id, 191) !== compact(provenance.brand_ref, 191)) return false;
  if (provenance.owner_scope_type !== "brand" && compact(row.brand_id, 191)) return false;
  return true;
}

export async function loadTenantPlatformPluginOwnershipScopedConnections({
  pool,
  pluginKey,
  tenantId,
  workspaceId,
  userId,
  brandRef = null,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A SQL pool is required for tenant connection ownership resolution.");
  }

  const plugin = compact(pluginKey, 128);
  const tenant = compact(tenantId, 64);
  const workspace = compact(workspaceId, 64);
  const user = compact(userId, 64);
  const requestedBrandRef = compact(brandRef, 191) || null;
  if (!plugin || !tenant || !workspace || !user) {
    return denied(
      "connection_workspace_scope_required",
      PlatformPluginConnectionOwnershipDenialCode.WORKSPACE_REQUIRED,
      { workspace_id_present: Boolean(workspace), brand_ref_present: Boolean(requestedBrandRef) },
    );
  }

  const [workspaceRowsRaw] = await pool.query(WORKSPACE_OWNERSHIP_SQL, [tenant, workspace]);
  const workspaceRows = Array.isArray(workspaceRowsRaw) ? workspaceRowsRaw : [];
  if (workspaceRows.length !== 1) {
    return denied(
      "connection_ownership_scope_denied",
      PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
      { workspace_id_present: true, brand_ref_present: Boolean(requestedBrandRef) },
    );
  }

  const workspaceRow = workspaceRows[0];
  const workspaceType = compact(workspaceRow.workspace_type, 32).toLowerCase();
  const ownershipType = compact(workspaceRow.workspace_ownership_type, 32).toLowerCase();

  if (workspaceType === "brand" || !["personal", "company"].includes(ownershipType)) {
    return denied(
      workspaceType === "brand"
        ? "brand_child_workspace_is_not_root_connection_context"
        : "connection_ownership_scope_denied",
      PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
      {
        workspace_id_present: true,
        brand_ref_present: Boolean(requestedBrandRef),
        root_workspace_required: true,
      },
    );
  }

  if (ownershipType === "personal" && (
    !workspaceRow.owner_user_id || String(workspaceRow.owner_user_id) !== user
  )) {
    return denied(
      "connection_ownership_scope_denied",
      PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
      { workspace_id_present: true, brand_ref_present: Boolean(requestedBrandRef) },
    );
  }

  let ownerScopeType = ownershipType === "personal" ? "personal_workspace" : "company_workspace";
  let ownerScopeRef = workspace;
  let credentialScope = ownershipType === "personal" ? "user_connection" : "tenant_connection";
  let brandAuthority = null;

  if (requestedBrandRef) {
    brandAuthority = await resolveBrandConnectionUseAuthority({
      pool,
      tenant,
      user,
      brandRef: requestedBrandRef,
    });
    if (!brandAuthority.allowed) {
      return denied(
        "brand_connection_authority_required",
        PlatformPluginConnectionOwnershipDenialCode.BRAND_AUTHORITY_REQUIRED,
        {
          workspace_id_present: true,
          brand_ref_present: true,
          workspace_ownership_type: ownershipType,
        },
      );
    }
    ownerScopeType = "brand";
    ownerScopeRef = requestedBrandRef;
    credentialScope = "tenant_connection";
  }

  const provenance = buildCredentialScopeProvenance({
    tenant,
    workspace,
    plugin,
    user,
    ownershipType,
    ownerScopeType,
    ownerScopeRef,
    credentialScope,
    ownershipRevision: workspaceRow.ownership_revision,
    requestedBrandRef,
    brandAuthority,
  });

  const connectionQuery = ownerScopeType === "brand"
    ? pool.query(BRAND_OWNERSHIP_SCOPED_CONNECTION_SQL, [
      tenant,
      workspace,
      plugin,
      ownerScopeRef,
      requestedBrandRef,
    ])
    : pool.query(OWNERSHIP_SCOPED_CONNECTION_SQL, [
      tenant,
      workspace,
      plugin,
      ownerScopeType,
      ownerScopeRef,
      ownerScopeType,
      user,
    ]);
  const [rowsRaw] = await connectionQuery;
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  if (rows.some((row) => !rowMatchesProvenance(row, provenance))) {
    return denied(
      "connection_credential_scope_provenance_invalid",
      PlatformPluginConnectionOwnershipDenialCode.PROVENANCE_INVALID,
      {
        workspace_id_present: true,
        brand_ref_present: Boolean(requestedBrandRef),
        workspace_ownership_type: ownershipType,
        expected_credential_scope: credentialScope,
      },
    );
  }

  const connections = rows.map((row) => Object.freeze({
    connection_id: row.connection_id,
    tenant_id: row.tenant_id,
    user_id: credentialScope === "user_connection" ? user : null,
    app_key: row.app_key,
    auth_type: row.auth_type,
    status: row.status,
    validation_status: row.validation_status || null,
    last_validated_at: row.last_validated_at || null,
    last_used_at: row.last_used_at || null,
    is_primary: row.is_primary || 0,
    credential_scope: credentialScope,
    credential_scope_provenance: provenance,
    workspace_id: workspace,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: ownerScopeRef,
    secrets_included: false,
  }));

  return Object.freeze({
    ok: true,
    reason: "connection_ownership_scope_resolved",
    denial_code: null,
    credential_scope: credentialScope,
    credential_scope_provenance: provenance,
    workspace_ownership_type: ownershipType,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: ownerScopeRef,
    brand_ref: requestedBrandRef,
    ownership_revision: Number(workspaceRow.ownership_revision || 0),
    connections,
    row_count: connections.length,
    brand_connections_included: ownerScopeType === "brand",
    brand_authority_source: brandAuthority?.source || null,
    secrets_included: false,
  });
}

export const _testingPlatformPluginConnectionOwnership = Object.freeze({
  WORKSPACE_OWNERSHIP_SQL,
  BRAND_TENANT_MEMBERSHIP_SQL,
  BRAND_RESOURCE_GRANT_SQL,
  OWNERSHIP_SCOPED_CONNECTION_SQL,
  BRAND_OWNERSHIP_SCOPED_CONNECTION_SQL,
  BRAND_CONNECTION_USE_PERMISSIONS,
  buildCredentialScopeProvenance,
  rowMatchesProvenance,
});
