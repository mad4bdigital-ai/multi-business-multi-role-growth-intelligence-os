import assert from "node:assert/strict";
import { assertGrantResourceInWorkspace } from "./workspaceGrantResourceAuthority.js";

function fakeConnection(resultSets) {
  const queue = Array.isArray(resultSets?.[0]) ? resultSets : [resultSets];
  let index = 0;
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rows = queue[Math.min(index, queue.length - 1)] || [];
      index += 1;
      return [rows];
    },
  };
}

async function expectAuthorityError(input, resultSets, expectedCode) {
  const connection = fakeConnection(resultSets);
  await assert.rejects(
    () => assertGrantResourceInWorkspace(connection, input),
    (error) => error?.code === expectedCode
  );
  return connection;
}

{
  const connection = fakeConnection([{ tenant_id: "tenant-a", status: "active" }]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "workspace",
    resourceRef: "tenant-a",
  });
  assert.deepEqual(result, { resource_ref: "tenant-a", authority_source: "tenants" });
  assert.match(connection.queries[0].sql, /FOR UPDATE/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "workspace", resourceRef: "tenant-b" },
  [],
  "workspace_resource_cross_tenant"
);

{
  const connection = fakeConnection([{ app_id: "app-a", tenant_id: "tenant-a", status: "active" }]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "app",
    resourceRef: "app-a",
  });
  assert.deepEqual(result, { resource_ref: "app-a", authority_source: "developer_apps" });
  assert.deepEqual(connection.queries[0].params, ["app-a"]);
  assert.match(connection.queries[0].sql, /developer_apps/);
  assert.match(connection.queries[0].sql, /FOR UPDATE/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "app", resourceRef: "app-missing" },
  [],
  "workspace_resource_not_found"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "app", resourceRef: "app-b" },
  [{ app_id: "app-b", tenant_id: "tenant-b", status: "active" }],
  "workspace_resource_cross_tenant"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "app", resourceRef: "app-suspended" },
  [{ app_id: "app-suspended", tenant_id: "tenant-a", status: "suspended" }],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "app", resourceRef: "app-ambiguous" },
  [
    { app_id: "app-ambiguous", tenant_id: "tenant-a", status: "active" },
    { app_id: "app-ambiguous", tenant_id: "tenant-a", status: "active" },
  ],
  "workspace_resource_ambiguous"
);

{
  const connection = fakeConnection([
    [{ site_id: "site-a", platform_status: "active" }],
    [
      { grant_id: "site-grant-a", tenant_id: "tenant-a", status: "active", not_expired: 1 },
      { grant_id: "site-grant-b", tenant_id: "tenant-a", status: "active", not_expired: 1 },
    ],
  ]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "site",
    resourceRef: "site-a",
  });
  assert.deepEqual(result, { resource_ref: "site-a", authority_source: "cms_sites+cms_site_access_grants" });
  assert.equal(connection.queries.length, 2);
  assert.deepEqual(connection.queries[0].params, ["site-a"]);
  assert.deepEqual(connection.queries[1].params, ["site-a", "tenant-a"]);
  assert.match(connection.queries[1].sql, /site_id=\? AND tenant_id=\?/);
  assert.match(connection.queries[1].sql, /FOR UPDATE/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "site", resourceRef: "site-missing" },
  [[]],
  "workspace_resource_not_found"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "site", resourceRef: "site-pending" },
  [[{ site_id: "site-pending", platform_status: "pending" }]],
  "workspace_resource_inactive"
);

{
  const connection = await expectAuthorityError(
    { tenantId: "tenant-a", resourceType: "site", resourceRef: "site-other" },
    [
      [{ site_id: "site-other", platform_status: "active" }],
      [],
    ],
    "workspace_resource_cross_tenant"
  );
  assert.deepEqual(connection.queries[1].params, ["site-other", "tenant-a"]);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "site", resourceRef: "site-revoked" },
  [
    [{ site_id: "site-revoked", platform_status: "active" }],
    [{ grant_id: "site-grant-revoked", tenant_id: "tenant-a", status: "revoked", not_expired: 1 }],
  ],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "site", resourceRef: "site-expired" },
  [
    [{ site_id: "site-expired", platform_status: "active" }],
    [{ grant_id: "site-grant-expired", tenant_id: "tenant-a", status: "active", not_expired: 0 }],
  ],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "asset", resourceRef: "asset-missing" },
  [],
  "workspace_resource_not_found"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "asset", resourceRef: "asset-b" },
  [{ asset_id: "asset-b", tenant_id: "tenant-b", lifecycle_status: "active" }],
  "workspace_resource_cross_tenant"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "asset", resourceRef: "asset-ambiguous" },
  [
    { asset_id: "asset-ambiguous", tenant_id: "tenant-a", lifecycle_status: "active" },
    { asset_id: "asset-ambiguous", tenant_id: "tenant-a", lifecycle_status: "active" },
  ],
  "workspace_resource_ambiguous"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "asset", resourceRef: "asset-deleted" },
  [{ asset_id: "asset-deleted", tenant_id: "tenant-a", lifecycle_status: "deleted" }],
  "workspace_resource_inactive"
);

{
  const connection = fakeConnection([{ vault_id: "vault-a", tenant_id: "tenant-a", status: "active" }]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "vault",
    resourceRef: "vault-a",
  });
  assert.deepEqual(result, { resource_ref: "vault-a", authority_source: "workspace_vaults" });
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "vault", resourceRef: "vault-pending" },
  [{ vault_id: "vault-pending", tenant_id: "tenant-a", status: "pending" }],
  "workspace_resource_inactive"
);

{
  const connection = fakeConnection([
    { tenant_id: "tenant-a", brand_target_key: "brand-one", link_status: "active", brand_status: "active" },
  ]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "brand",
    resourceRef: "brand:brand-one",
  });
  assert.deepEqual(result, { resource_ref: "brand-one", authority_source: "tenant_brand_links" });
  assert.deepEqual(connection.queries[0].params, ["brand-one", "brand-one", "brand-one"]);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-two" },
  [{ tenant_id: "tenant-b", brand_target_key: "brand-two", link_status: "active", brand_status: "active" }],
  "workspace_resource_cross_tenant"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-three" },
  [{ tenant_id: "tenant-a", brand_target_key: "brand-three", link_status: "inactive", brand_status: "active" }],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-four" },
  [
    { tenant_id: "tenant-a", brand_target_key: "brand-four", link_status: "active", brand_status: "active" },
    { tenant_id: "tenant-a", brand_target_key: "brand-four", link_status: "active", brand_status: "active" },
  ],
  "workspace_resource_ambiguous"
);

for (const resourceType of ["workflow", "agent"]) {
  const connection = await expectAuthorityError(
    { tenantId: "tenant-a", resourceType, resourceRef: `${resourceType}-one` },
    [],
    "workspace_resource_reference_unverifiable"
  );
  assert.equal(connection.queries.length, 0, `${resourceType} must fail closed before any guessed authority query`);
}

console.log("workspace resource grant canonical validation tests passed");
