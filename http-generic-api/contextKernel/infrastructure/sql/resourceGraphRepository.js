import {
  clampLimit,
  cleanOptional,
  cleanRequired,
  createSqlExecutor,
  freezeRecords,
  parseJsonValue,
} from "./sqlRepositorySupport.js";

function workspaceGrantSql({ resourceType, limit }) {
  return `
    SELECT
      g.grant_id,
      g.tenant_id,
      g.grantee_user_id,
      g.membership_role,
      g.resource_type,
      g.resource_ref,
      g.permission,
      g.source,
      g.granted_at,
      g.expires_at
    FROM v_workspace_resource_grant_effective g
    WHERE g.tenant_id = ?
      AND g.grantee_user_id = ?
      AND g.membership_status = 'active'
      AND g.grant_status = 'active'
      AND (g.expires_at IS NULL OR g.expires_at > UTC_TIMESTAMP())
      ${resourceType ? "AND g.resource_type = ?" : ""}
    ORDER BY g.resource_type ASC, g.resource_ref ASC, g.permission ASC, g.grant_id ASC
    LIMIT ${limit}
  `;
}

function platformAuthoritySql({ resourceType, limit }) {
  return `
    SELECT
      b.binding_id,
      b.tenant_id,
      b.workspace_id,
      b.user_id,
      b.resource_type,
      b.resource_uri,
      b.resource_ref_json,
      b.recipe_key,
      b.permission_level,
      b.allowed_modes_json,
      b.authority_source,
      b.expires_at,
      b.updated_at
    FROM v_effective_platform_resource_authority_bindings b
    WHERE b.tenant_id = ?
      AND (b.user_id = ? OR b.user_id IS NULL)
      AND b.status = 'active'
      AND b.is_effective = 1
      AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP())
      ${resourceType ? "AND b.resource_type = ?" : ""}
    ORDER BY b.resource_type ASC, b.resource_uri ASC, b.binding_id ASC
    LIMIT ${limit}
  `;
}

function mapWorkspaceGrant(row) {
  return {
    sourceType: "workspace_resource_grant",
    stableRef: row.grant_id,
    tenantRef: row.tenant_id,
    userRef: row.grantee_user_id,
    workspaceRef: row.resource_type === "workspace" ? row.resource_ref : null,
    resourceType: row.resource_type,
    resourceRef: row.resource_ref,
    permission: row.permission,
    authoritySource: row.source,
    role: row.membership_role,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

function mapPlatformAuthority(row) {
  return {
    sourceType: "platform_resource_authority",
    stableRef: row.binding_id,
    tenantRef: row.tenant_id,
    userRef: row.user_id || null,
    workspaceRef: row.workspace_id || null,
    resourceType: row.resource_type,
    resourceRef: row.resource_uri,
    resourceReference: parseJsonValue(row.resource_ref_json, null),
    permission: row.permission_level,
    recipeKey: row.recipe_key || null,
    allowedModes: parseJsonValue(row.allowed_modes_json, []),
    authoritySource: row.authority_source,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

function compareResource(left, right) {
  return (
    String(left.resourceType || "").localeCompare(String(right.resourceType || "")) ||
    String(left.resourceRef || "").localeCompare(String(right.resourceRef || "")) ||
    String(left.sourceType || "").localeCompare(String(right.sourceType || "")) ||
    String(left.stableRef || "").localeCompare(String(right.stableRef || ""))
  );
}

export function createResourceGraphRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Resource graph" });

  async function listAuthorizedResources({ tenantRef, userRef, resourceType = null, limit = 100 }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const user = cleanRequired(userRef, "userRef");
    const type = cleanOptional(resourceType);
    const boundedLimit = clampLimit(limit);
    const filterParams = type ? [type] : [];

    const [workspaceRows, authorityRows] = await Promise.all([
      sql.execute(workspaceGrantSql({ resourceType: type, limit: boundedLimit }), [tenant, user, ...filterParams]),
      sql.execute(platformAuthoritySql({ resourceType: type, limit: boundedLimit }), [tenant, user, ...filterParams]),
    ]);

    return freezeRecords([
      ...workspaceRows.map(mapWorkspaceGrant),
      ...authorityRows.map(mapPlatformAuthority),
    ].sort(compareResource));
  }

  return Object.freeze({ listAuthorizedResources });
}

export const _testingResourceGraphRepository = Object.freeze({
  platformAuthoritySql,
  workspaceGrantSql,
});
