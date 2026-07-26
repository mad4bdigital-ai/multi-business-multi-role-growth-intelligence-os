import {
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  freezeRecords,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const MEMBERSHIP_SQL = `
  SELECT
    m.user_id,
    m.tenant_id,
    m.role,
    m.status,
    m.granted_at,
    m.updated_at
  FROM memberships m
  WHERE m.tenant_id = ?
    AND m.user_id = ?
    AND m.status = 'active'
  ORDER BY m.updated_at DESC
  LIMIT 2
`;

const WORKSPACES_SQL = `
  SELECT
    wr.workspace_id,
    wr.tenant_id,
    wr.workspace_key,
    wr.display_name,
    wr.workspace_type,
    wr.bootstrap_status,
    wr.linked_brand_key,
    wr.updated_at
  FROM workspace_registry wr
  WHERE wr.tenant_id = ?
  ORDER BY wr.workspace_key ASC, wr.workspace_id ASC
`;

function mapMembership(row) {
  if (!row) return null;
  return freezeRecord({
    userRef: row.user_id,
    tenantRef: row.tenant_id,
    role: row.role,
    status: row.status,
    grantedAt: row.granted_at,
    updatedAt: row.updated_at,
  });
}

function mapWorkspace(row) {
  return freezeRecord({
    workspaceRef: row.workspace_id,
    tenantRef: row.tenant_id,
    workspaceKey: row.workspace_key,
    displayName: row.display_name,
    workspaceType: row.workspace_type,
    bootstrapStatus: row.bootstrap_status,
    brandRef: row.linked_brand_key || null,
    updatedAt: row.updated_at,
  });
}

export function createAuthorizedScopeRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Authorized scope" });

  async function findAuthorizedScope({ tenantRef, userRef }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const user = cleanRequired(userRef, "userRef");
    const membershipRows = await sql.execute(MEMBERSHIP_SQL, [tenant, user]);
    const membership = requireUniqueRow(membershipRows, {
      code: "authorized_scope_membership_ambiguous",
      entityName: "Authorized tenant membership",
      details: { tenant_ref: tenant, user_ref: user },
    });
    if (!membership) return null;

    const workspaceRows = await sql.execute(WORKSPACES_SQL, [tenant]);
    return freezeRecord({
      tenantRef: tenant,
      userRef: user,
      membership: mapMembership(membership),
      workspaces: freezeRecords(workspaceRows.map(mapWorkspace)),
    });
  }

  return Object.freeze({ findAuthorizedScope });
}

export const _testingAuthorizedScopeRepository = Object.freeze({
  MEMBERSHIP_SQL,
  WORKSPACES_SQL,
});
