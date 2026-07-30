import {
  cleanOptional,
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const CONNECTION_OWNERSHIP_SQL = `
  SELECT
    connection_id,
    tenant_id,
    legacy_connected_user_id,
    provider_key,
    connection_status,
    link_id,
    workspace_id,
    workspace_key,
    link_status,
    workspace_tenant_id,
    workspace_type,
    workspace_ownership_type,
    workspace_owner_user_id,
    workspace_ownership_revision,
    ownership_id,
    owner_scope_type,
    owner_scope_ref,
    connection_owner_user_id,
    ownership_connected_by_user_id,
    brand_id,
    provider_account_ref,
    provider_account_binding_hash,
    provider_account_binding_version,
    authorization_revision,
    connection_revision,
    ownership_status,
    ownership_resolution_status
  FROM v_context_kernel_connection_ownership_compatibility
  WHERE tenant_id = ?
    AND workspace_id = ?
    AND connection_id = ?
  ORDER BY connection_id ASC, link_id ASC
  LIMIT 2
`;

function ownershipError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.details = { ...details };
  return error;
}

function validateOwnership(row, { effectiveUserRef = null, brandRef = null } = {}) {
  const details = {
    tenant_ref: row.tenant_id,
    workspace_ref: row.workspace_id,
    connection_ref: row.connection_id,
  };
  if (row.ownership_resolution_status !== "classified") {
    throw ownershipError(
      `connection_${row.ownership_resolution_status || "ownership_unclassified"}`,
      "Connection ownership is not safely classified.",
      { ...details, ownership_resolution_status: row.ownership_resolution_status || null },
    );
  }
  if (row.connection_status !== "active" || row.link_status !== "active" || row.ownership_status !== "active") {
    throw ownershipError(
      "connection_ownership_inactive",
      "Connection ownership is not active.",
      details,
    );
  }
  if (row.owner_scope_type === "personal_workspace") {
    if (!effectiveUserRef || row.connection_owner_user_id !== effectiveUserRef) {
      throw ownershipError(
        "connection_owner_mismatch",
        "Personal connection owner does not match the effective user.",
        { ...details, effective_user_ref: effectiveUserRef || null },
      );
    }
  }
  if (row.owner_scope_type === "brand") {
    if (!brandRef || row.brand_id !== brandRef) {
      throw ownershipError(
        "connection_brand_owner_mismatch",
        "Brand connection does not match the exact requested brand.",
        { ...details, brand_ref: brandRef || null },
      );
    }
  }
  if (!row.provider_account_ref && !row.provider_account_binding_hash) {
    throw ownershipError(
      "connection_provider_account_binding_missing",
      "Connection lacks a durable provider-account binding.",
      details,
    );
  }
}

function mapConnectionOwnership(row) {
  return freezeRecord({
    ownershipRef: row.ownership_id,
    connectionRef: row.connection_id,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id,
    workspaceKey: row.workspace_key || null,
    workspaceType: row.workspace_type,
    workspaceOwnershipType: row.workspace_ownership_type,
    workspaceOwnerUserRef: row.workspace_owner_user_id || null,
    workspaceOwnershipRevision: Number(row.workspace_ownership_revision || 0),
    ownerScopeType: row.owner_scope_type,
    ownerScopeRef: row.owner_scope_ref,
    ownerUserRef: row.connection_owner_user_id || null,
    brandRef: row.brand_id || null,
    connectedByUserRef:
      row.ownership_connected_by_user_id || row.legacy_connected_user_id || null,
    providerKey: row.provider_key,
    providerAccountRef: row.provider_account_ref || null,
    providerAccountBindingHash: row.provider_account_binding_hash || null,
    providerAccountBindingVersion: row.provider_account_binding_version || null,
    authorizationRevision: Number(row.authorization_revision || 0),
    connectionRevision: Number(row.connection_revision || 0),
    status: row.ownership_status,
    resolutionStatus: row.ownership_resolution_status,
    secretsIncluded: false,
  });
}

export function createConnectionOwnershipRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Connection ownership" });

  async function findConnectionOwnership({
    tenantRef,
    workspaceRef,
    connectionRef,
    effectiveUserRef = null,
    brandRef = null,
  }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const workspace = cleanRequired(workspaceRef, "workspaceRef");
    const connection = cleanRequired(connectionRef, "connectionRef");
    const effectiveUser = cleanOptional(effectiveUserRef);
    const brand = cleanOptional(brandRef);
    const rows = await sql.execute(CONNECTION_OWNERSHIP_SQL, [tenant, workspace, connection]);
    const row = requireUniqueRow(rows, {
      code: "connection_ownership_ambiguous",
      entityName: "Connection ownership",
      details: {
        tenant_ref: tenant,
        workspace_ref: workspace,
        connection_ref: connection,
      },
    });
    if (!row) return null;
    validateOwnership(row, { effectiveUserRef: effectiveUser, brandRef: brand });
    return mapConnectionOwnership(row);
  }

  return Object.freeze({ findConnectionOwnership });
}

export const _testingConnectionOwnershipRepository = Object.freeze({
  CONNECTION_OWNERSHIP_SQL,
  mapConnectionOwnership,
  validateOwnership,
});
