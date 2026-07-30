import {
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const WORKSPACE_OWNERSHIP_SQL = `
  SELECT
    workspace_id,
    tenant_id,
    workspace_key,
    display_name,
    workspace_type,
    workspace_ownership_type,
    owner_user_id,
    ownership_revision,
    bootstrap_status,
    updated_at
  FROM workspace_registry
  WHERE tenant_id = ?
    AND workspace_id = ?
  ORDER BY workspace_id ASC
  LIMIT 2
`;

function ownershipError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.details = { ...details };
  return error;
}

function mapWorkspaceOwnership(row) {
  const ownershipType = row.workspace_ownership_type || null;
  if (!ownershipType) {
    throw ownershipError(
      "workspace_ownership_unclassified",
      "Workspace ownership is not classified.",
      { tenant_ref: row.tenant_id, workspace_ref: row.workspace_id },
    );
  }
  if (ownershipType === "personal" && !row.owner_user_id) {
    throw ownershipError(
      "workspace_personal_owner_missing",
      "Personal workspace ownership requires an owner user.",
      { tenant_ref: row.tenant_id, workspace_ref: row.workspace_id },
    );
  }
  return freezeRecord({
    workspaceRef: row.workspace_id,
    tenantRef: row.tenant_id,
    workspaceKey: row.workspace_key || null,
    displayName: row.display_name || null,
    workspaceType: row.workspace_type,
    workspaceOwnershipType: ownershipType,
    ownerUserRef: row.owner_user_id || null,
    ownershipRevision: Number(row.ownership_revision || 0),
    bootstrapStatus: row.bootstrap_status || null,
    updatedAt: row.updated_at || null,
  });
}

export function createWorkspaceOwnershipRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Workspace ownership" });

  async function findWorkspaceOwnership({ tenantRef, workspaceRef }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const workspace = cleanRequired(workspaceRef, "workspaceRef");
    const rows = await sql.execute(WORKSPACE_OWNERSHIP_SQL, [tenant, workspace]);
    const row = requireUniqueRow(rows, {
      code: "workspace_ownership_ambiguous",
      entityName: "Workspace ownership",
      details: { tenant_ref: tenant, workspace_ref: workspace },
    });
    return row ? mapWorkspaceOwnership(row) : null;
  }

  return Object.freeze({ findWorkspaceOwnership });
}

export const _testingWorkspaceOwnershipRepository = Object.freeze({
  WORKSPACE_OWNERSHIP_SQL,
  mapWorkspaceOwnership,
});
