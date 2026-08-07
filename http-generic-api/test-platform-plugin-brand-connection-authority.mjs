import assert from "node:assert/strict";
import {
  _testingPlatformPluginConnectionOwnership,
  loadTenantPlatformPluginOwnershipScopedConnections,
} from "./platformPluginConnectionOwnership.js";

function brandConnectionRow({ id = "conn-brand-a", brandRef = "brand-a" } = {}) {
  return {
    connection_id: id,
    tenant_id: "tenant-1",
    app_key: "github",
    auth_type: "oauth2",
    status: "active",
    validation_status: "validated",
    last_validated_at: "2026-08-07T12:00:00.000Z",
    last_used_at: null,
    is_primary: 1,
    workspace_id: "brand-workspace-a",
    owner_scope_type: "brand",
    owner_scope_ref: brandRef,
    brand_id: brandRef,
    ownership_status: "active",
    ownership_resolution_status: "classified",
    access_token: `secret-${id}`,
  };
}

function makeBrandPool({
  membershipRole = "member",
  membershipRows = null,
  grantPermission = "operate",
  grantRows = null,
  linkedBrandKey = "brand-a",
  connectionRows = [brandConnectionRow()],
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM workspace_registry")) {
        return [[{
          workspace_id: "brand-workspace-a",
          tenant_id: "tenant-1",
          workspace_type: "brand",
          workspace_ownership_type: "company",
          owner_user_id: null,
          linked_brand_key: linkedBrandKey,
          bootstrap_status: "ready",
          ownership_revision: 11,
        }]];
      }
      if (sql.includes("FROM memberships")) {
        if (Array.isArray(membershipRows)) return [membershipRows];
        return [[{
          user_id: "user-1",
          tenant_id: "tenant-1",
          role: membershipRole,
          status: "active",
        }]];
      }
      if (sql.includes("FROM v_workspace_resource_grant_effective")) {
        if (Array.isArray(grantRows)) return [grantRows];
        return grantPermission ? [[{
          grant_id: "grant-brand-a",
          tenant_id: "tenant-1",
          grantee_user_id: "user-1",
          resource_ref: "brand-a",
          permission: grantPermission,
          grant_status: "active",
          membership_role: membershipRole,
        }]] : [[]];
      }
      if (sql.includes("FROM v_context_kernel_connection_ownership_compatibility")) {
        return [connectionRows];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

{
  const sql = _testingPlatformPluginConnectionOwnership.BRAND_OWNERSHIP_SCOPED_CONNECTION_SQL;
  assert.match(sql, /owner_scope_type = 'brand'/);
  assert.match(sql, /BINARY v\.owner_scope_ref <=> BINARY \?/);
  assert.match(sql, /BINARY v\.brand_id <=> BINARY \?/);
  assert.doesNotMatch(sql, /access_token|refresh_token|password|api_key|encrypted_credentials|secret/i);
  assert.match(_testingPlatformPluginConnectionOwnership.OWNERSHIP_SCOPED_CONNECTION_SQL, /v\.brand_id IS NULL/);
  assert.deepEqual(
    [..._testingPlatformPluginConnectionOwnership.BRAND_CONNECTION_USE_PERMISSIONS].sort(),
    ["admin", "manage", "operate", "owner"],
  );
}

{
  const pool = makeBrandPool({ membershipRole: "member", grantPermission: "operate" });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.credential_scope, "tenant_connection");
  assert.equal(result.owner_scope_type, "brand");
  assert.equal(result.owner_scope_ref, "brand-a");
  assert.equal(result.brand_connections_included, true);
  assert.equal(result.brand_authority_source, "workspace_resource_grant");
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].connection_id, "conn-brand-a");
  assert.equal(result.connections[0].owner_scope_type, "brand");
  assert.equal(result.connections[0].owner_scope_ref, "brand-a");
  assert.equal(JSON.stringify(result).includes("secret-conn-brand-a"), false);
  const grantCall = pool.calls.find((call) => call.sql.includes("v_workspace_resource_grant_effective"));
  assert.deepEqual(grantCall.params, ["tenant-1", "user-1", "brand-a"]);
  const connectionCall = pool.calls.find((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility"));
  assert.deepEqual(connectionCall.params, ["tenant-1", "brand-workspace-a", "github", "brand-a", "brand-a"]);
}

for (const grantPermission of ["manage", "admin", "owner"]) {
  const pool = makeBrandPool({ membershipRole: "member", grantPermission });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, true, `${grantPermission} must be strong enough to use a Brand connection`);
  assert.equal(result.brand_authority_source, "workspace_resource_grant");
}

for (const grantPermission of ["view", "comment", "edit"]) {
  const pool = makeBrandPool({ membershipRole: "member", grantPermission });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, false, `${grantPermission} must not authorize Brand provider credential use`);
  assert.equal(result.denial_code, "BRAND_CONNECTION_AUTHORITY_REQUIRED");
  assert.equal(result.row_count, 0);
  assert.equal(result.brand_connections_included, false);
  assert.equal(JSON.stringify(result).includes("brand-a"), false);
  assert.equal(pool.calls.some((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility")), false);
}

{
  const pool = makeBrandPool({ membershipRole: "owner", grantPermission: null });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.brand_authority_source, "tenant_owner_membership");
  assert.equal(pool.calls.some((call) => call.sql.includes("v_workspace_resource_grant_effective")), false);
}

{
  const pool = makeBrandPool({ membershipRole: "admin", grantPermission: null });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.brand_authority_source, "tenant_owner_membership");
  assert.equal(pool.calls.some((call) => call.sql.includes("v_workspace_resource_grant_effective")), false);
}

{
  const pool = makeBrandPool({ membershipRole: "member", grantPermission: null });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "BRAND_CONNECTION_AUTHORITY_REQUIRED");
  assert.equal(result.row_count, 0);
  assert.equal(result.brand_connections_included, false);
  assert.equal(Object.hasOwn(result, "owner_scope_ref"), true);
  assert.equal(result.owner_scope_ref, null);
  assert.equal(JSON.stringify(result).includes("brand-a"), false);
  assert.equal(pool.calls.some((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility")), false);
}

{
  const pool = makeBrandPool({ membershipRows: [] });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "BRAND_CONNECTION_AUTHORITY_REQUIRED");
  assert.equal(pool.calls.some((call) => call.sql.includes("v_workspace_resource_grant_effective")), false);
  assert.equal(pool.calls.some((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility")), false);
}

{
  const pool = makeBrandPool({ linkedBrandKey: "" });
  const result = await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial_code, "BRAND_CONNECTION_AUTHORITY_REQUIRED");
  assert.equal(pool.calls.some((call) => call.sql.includes("FROM memberships")), false);
}

{
  const pool = makeBrandPool({
    membershipRole: "member",
    grantPermission: "operate",
    connectionRows: [brandConnectionRow({ id: "conn-brand-b", brandRef: "brand-b" })],
  });
  await loadTenantPlatformPluginOwnershipScopedConnections({
    pool,
    pluginKey: "github",
    tenantId: "tenant-1",
    workspaceId: "brand-workspace-a",
    userId: "user-1",
  });
  const connectionCall = pool.calls.find((call) => call.sql.includes("v_context_kernel_connection_ownership_compatibility"));
  assert.deepEqual(connectionCall.params.slice(-2), ["brand-a", "brand-a"]);
}

console.log("platform plugin brand connection authority tests passed");
