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
    { tenant_id: "tenant-a", brand_target_key: "brand-one", link_status: "active" },
  ]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "brand",
    resourceRef: "brand:brand-one",
  });
  assert.deepEqual(result, { resource_ref: "brand-one", authority_source: "tenant_brand_links" });
  assert.deepEqual(connection.queries[0].params, ["brand-one", "brand-one", "brand-one"]);
  assert.match(connection.queries[0].sql, /tbl\.status AS link_status/);
  assert.match(connection.queries[0].sql, /JOIN brands b ON LOWER\(b\.target_key\) = LOWER\(tbl\.brand_target_key\)/);
  assert.doesNotMatch(connection.queries[0].sql, /\bb\.status\b/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-two" },
  [{ tenant_id: "tenant-b", brand_target_key: "brand-two", link_status: "active" }],
  "workspace_resource_cross_tenant"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-three" },
  [{ tenant_id: "tenant-a", brand_target_key: "brand-three", link_status: "inactive" }],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "brand", resourceRef: "brand-four" },
  [
    { tenant_id: "tenant-a", brand_target_key: "brand-four", link_status: "active" },
    { tenant_id: "tenant-a", brand_target_key: "brand-four", link_status: "active" },
  ],
  "workspace_resource_ambiguous"
);

{
  const connection = fakeConnection([
    [{ agent_id: "agent-one", status: "active", health_status: "degraded" }],
    [
      { binding_id: "agent-binding-1", resource_ref: "agent-one", effect: "allow", status: "active", container_id: "container-a", container_status: "active", dimension_key: "agents", dimension_status: "active" },
      { binding_id: "agent-binding-2", resource_ref: "agent-one", effect: "allow", status: "active", container_id: "container-b", container_status: "active", dimension_key: "agents", dimension_status: "active" },
    ],
  ]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "agent",
    resourceRef: "agent-one",
  });
  assert.deepEqual(result, { resource_ref: "agent-one", authority_source: "agents+container_resource_bindings" });
  assert.equal(connection.queries.length, 2);
  assert.deepEqual(connection.queries[0].params, ["agent-one"]);
  assert.deepEqual(connection.queries[1].params, ["tenant-a", "agents", "agent", "agent-one"]);
  assert.match(connection.queries[1].sql, /container_resource_bindings/);
  assert.match(connection.queries[1].sql, /JOIN containers/);
  assert.match(connection.queries[1].sql, /container_resource_dimension_registry/);
  assert.match(connection.queries[1].sql, /crb\.effect = 'allow'/);
  assert.match(connection.queries[1].sql, /valid_until IS NULL OR crb\.valid_until > UTC_TIMESTAMP\(\)/);
  assert.match(connection.queries[1].sql, /FOR UPDATE/);
  assert.doesNotMatch(connection.queries[1].sql, /v_activation_agent_catalog/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "agent", resourceRef: "agent-missing" },
  [[]],
  "workspace_resource_not_found"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "agent", resourceRef: "agent-draft" },
  [[{ agent_id: "agent-draft", status: "draft", health_status: "active" }]],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "agent", resourceRef: "agent-ambiguous" },
  [[
    { agent_id: "agent-ambiguous", status: "active", health_status: "active" },
    { agent_id: "agent-ambiguous", status: "active", health_status: "active" },
  ]],
  "workspace_resource_ambiguous"
);

{
  const connection = await expectAuthorityError(
    { tenantId: "tenant-a", resourceType: "agent", resourceRef: "agent-unbound" },
    [
      [{ agent_id: "agent-unbound", status: "active", health_status: "active" }],
      [],
    ],
    "workspace_resource_reference_unverifiable"
  );
  assert.equal(connection.queries.length, 2);
}

{
  const connection = fakeConnection([
    [{ workflow_id: "workflow-id-one", workflow_key: "workflow-key-one", status: "active", active: "TRUE" }],
    [
      { binding_id: "workflow-binding-1", resource_ref: "workflow-key-one", effect: "allow", status: "active", container_id: "container-a", container_status: "active", dimension_key: "workflows", dimension_status: "active" },
      { binding_id: "workflow-binding-2", resource_ref: "workflow-id-one", effect: "allow", status: "active", container_id: "container-b", container_status: "active", dimension_key: "workflows", dimension_status: "active" },
    ],
  ]);
  const result = await assertGrantResourceInWorkspace(connection, {
    tenantId: "tenant-a",
    resourceType: "workflow",
    resourceRef: "workflow-id-one",
  });
  assert.deepEqual(result, { resource_ref: "workflow-key-one", authority_source: "workflows+container_resource_bindings" });
  assert.equal(connection.queries.length, 2);
  assert.deepEqual(connection.queries[0].params, ["workflow-id-one", "workflow-id-one"]);
  assert.deepEqual(connection.queries[1].params, ["tenant-a", "workflows", "workflow", "workflow-key-one", "workflow-id-one"]);
  assert.match(connection.queries[1].sql, /container_resource_bindings/);
  assert.match(connection.queries[1].sql, /crb\.effect = 'allow'/);
  assert.doesNotMatch(connection.queries[1].sql, /v_activation_workflow_catalog/);
}

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "workflow", resourceRef: "workflow-missing" },
  [[]],
  "workspace_resource_not_found"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "workflow", resourceRef: "workflow-disabled" },
  [[{ workflow_id: "workflow-disabled", workflow_key: "workflow-disabled", status: "disabled", active: "FALSE" }]],
  "workspace_resource_inactive"
);

await expectAuthorityError(
  { tenantId: "tenant-a", resourceType: "workflow", resourceRef: "workflow-ambiguous" },
  [[
    { workflow_id: "workflow-ambiguous", workflow_key: "workflow-a", status: "active", active: "TRUE" },
    { workflow_id: "workflow-b", workflow_key: "workflow-ambiguous", status: "active", active: "TRUE" },
  ]],
  "workspace_resource_ambiguous"
);

{
  const connection = await expectAuthorityError(
    { tenantId: "tenant-a", resourceType: "workflow", resourceRef: "workflow-unbound-id" },
    [
      [{ workflow_id: "workflow-unbound-id", workflow_key: "workflow-unbound-key", status: "active", active: "TRUE" }],
      [],
    ],
    "workspace_resource_reference_unverifiable"
  );
  assert.equal(connection.queries.length, 2);
  assert.deepEqual(connection.queries[1].params, ["tenant-a", "workflows", "workflow", "workflow-unbound-key", "workflow-unbound-id"]);
}

console.log("workspace resource grant canonical validation tests passed");
