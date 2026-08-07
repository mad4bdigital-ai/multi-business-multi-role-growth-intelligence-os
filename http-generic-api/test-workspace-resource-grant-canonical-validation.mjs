import assert from "node:assert/strict";
import { assertGrantResourceInWorkspace } from "./workspaceGrantResourceAuthority.js";

function fakeConnection(rows) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return [rows];
    },
  };
}

async function expectAuthorityError(input, rows, expectedCode) {
  const connection = fakeConnection(rows);
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

for (const resourceType of ["site", "app", "workflow", "agent"]) {
  const connection = await expectAuthorityError(
    { tenantId: "tenant-a", resourceType, resourceRef: `${resourceType}-one` },
    [],
    "workspace_resource_reference_unverifiable"
  );
  assert.equal(connection.queries.length, 0, `${resourceType} must fail closed before any guessed authority query`);
}

console.log("workspace resource grant canonical validation tests passed");
