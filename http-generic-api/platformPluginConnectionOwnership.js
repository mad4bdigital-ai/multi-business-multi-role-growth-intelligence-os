function compact(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function denied(reason, denialCode, details = {}) {
  return Object.freeze({
    ok: false,
    reason,
    denial_code: denialCode,
    credential_scope: null,
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
  SELECT workspace_id, tenant_id, workspace_ownership_type, owner_user_id, ownership_revision
    FROM workspace_registry
   WHERE tenant_id = ?
     AND workspace_id = ?
   ORDER BY workspace_id ASC
   LIMIT 2
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

export const PlatformPluginConnectionOwnershipDenialCode = Object.freeze({
  WORKSPACE_REQUIRED: "CONNECTION_WORKSPACE_REQUIRED",
  SCOPE_DENIED: "CONNECTION_OWNERSHIP_SCOPE_DENIED",
  SCOPE_MISMATCH: "CONNECTION_OWNERSHIP_SCOPE_MISMATCH",
});

export async function loadTenantPlatformPluginOwnershipScopedConnections({
  pool,
  pluginKey,
  tenantId,
  workspaceId,
  userId,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A SQL pool is required for tenant connection ownership resolution.");
  }

  const plugin = compact(pluginKey, 128);
  const tenant = compact(tenantId, 64);
  const workspace = compact(workspaceId, 64);
  const user = compact(userId, 64);
  if (!plugin || !tenant || !workspace || !user) {
    return denied(
      "connection_workspace_scope_required",
      PlatformPluginConnectionOwnershipDenialCode.WORKSPACE_REQUIRED,
      { workspace_id_present: Boolean(workspace) },
    );
  }

  const [workspaceRowsRaw] = await pool.query(WORKSPACE_OWNERSHIP_SQL, [tenant, workspace]);
  const workspaceRows = Array.isArray(workspaceRowsRaw) ? workspaceRowsRaw : [];
  if (workspaceRows.length !== 1) {
    return denied(
      "connection_ownership_scope_denied",
      PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
      { workspace_id_present: true },
    );
  }

  const workspaceRow = workspaceRows[0];
  const ownershipType = compact(workspaceRow.workspace_ownership_type, 32).toLowerCase();
  let ownerScopeType = null;
  let credentialScope = null;
  if (ownershipType === "personal") {
    if (!workspaceRow.owner_user_id || String(workspaceRow.owner_user_id) !== user) {
      return denied(
        "connection_ownership_scope_denied",
        PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
        { workspace_id_present: true },
      );
    }
    ownerScopeType = "personal_workspace";
    credentialScope = "user_connection";
  } else if (ownershipType === "company") {
    ownerScopeType = "company_workspace";
    credentialScope = "tenant_connection";
  } else {
    return denied(
      "connection_ownership_scope_denied",
      PlatformPluginConnectionOwnershipDenialCode.SCOPE_DENIED,
      { workspace_id_present: true },
    );
  }

  const [rowsRaw] = await pool.query(OWNERSHIP_SCOPED_CONNECTION_SQL, [
    tenant,
    workspace,
    plugin,
    ownerScopeType,
    workspace,
    ownerScopeType,
    user,
  ]);
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
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
    workspace_id: workspace,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: workspace,
    secrets_included: false,
  }));

  return Object.freeze({
    ok: true,
    reason: "connection_ownership_scope_resolved",
    denial_code: null,
    credential_scope: credentialScope,
    workspace_ownership_type: ownershipType,
    owner_scope_type: ownerScopeType,
    owner_scope_ref: workspace,
    ownership_revision: Number(workspaceRow.ownership_revision || 0),
    connections,
    row_count: connections.length,
    brand_connections_included: false,
    secrets_included: false,
  });
}

export const _testingPlatformPluginConnectionOwnership = Object.freeze({
  WORKSPACE_OWNERSHIP_SQL,
  OWNERSHIP_SCOPED_CONNECTION_SQL,
});
