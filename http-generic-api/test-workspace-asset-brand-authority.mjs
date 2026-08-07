import assert from "node:assert/strict";
import { createResourceRepository } from "./src/infrastructure/resourceApi/resourceRepository.js";
import { assertWorkspaceAssetBrandPatchSafe } from "./workspaceAssetBrandAuthority.js";

function brandAuthorityRow(tenantId = "tenant-a", key = "brand-key") {
  return [{
    tenant_id: tenantId,
    brand_target_key: key,
    link_status: "active",
    brand_status: "active",
  }];
}

function memberRow(role = "member") {
  return [{
    user_id: "user-a",
    tenant_id: "tenant-a",
    role,
    status: "active",
    tenant_status: "active",
  }];
}

function buildExecutor({
  canonicalRows = brandAuthorityRow(),
  membershipRows = memberRow(),
  grantRows = [{ grant_id: "grant-a", permission: "edit" }],
} = {}) {
  const calls = [];
  const inserted = [];
  return {
    calls,
    inserted,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM tenant_brand_links tbl")) return [canonicalRows];
      if (sql.includes("FROM memberships m") && sql.includes("FOR UPDATE")) return [membershipRows];
      if (sql.includes("FROM v_workspace_resource_grant_effective")) return [grantRows];
      if (sql.includes("INSERT INTO workspace_assets")) {
        inserted.push(params);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in workspace asset Brand authority test: ${sql}`);
    },
  };
}

async function insert(executor, overrides = {}) {
  const repository = createResourceRepository({ pool: executor, transactionConnection: true });
  return repository.insertAsset({
    tenantId: overrides.tenantId || "tenant-a",
    actorId: overrides.actorId || "user-a",
    input: {
      asset_id: overrides.assetId || "asset-a",
      asset_type: "document",
      display_name: "Brand brief",
      brand_ref: overrides.brandRef === undefined ? "Brand Alias" : overrides.brandRef,
    },
  });
}

{
  const executor = buildExecutor();
  await insert(executor);
  assert.equal(executor.inserted.length, 1);
  assert.equal(executor.inserted[0][6], "brand-key", "delegated edit authority must persist the canonical Brand target key");
  assert(executor.calls.some((call) => call.sql.includes("v_workspace_resource_grant_effective")), "delegated member must prove an effective Brand grant");
}

{
  const executor = buildExecutor({ membershipRows: memberRow("owner"), grantRows: [] });
  await insert(executor);
  assert.equal(executor.inserted[0][6], "brand-key");
  assert(!executor.calls.some((call) => call.sql.includes("v_workspace_resource_grant_effective")), "workspace owner must not require a redundant Brand grant");
}

{
  const executor = buildExecutor({ grantRows: [{ grant_id: "grant-view", permission: "view" }] });
  await assert.rejects(
    insert(executor),
    (error) => error?.code === "workspace_asset_brand_mutation_forbidden" && error?.status === 403
  );
  assert.equal(executor.inserted.length, 0, "read-only Brand authority must fail before asset insert");
}

{
  const executor = buildExecutor({ grantRows: [] });
  await assert.rejects(
    insert(executor),
    (error) => error?.code === "workspace_asset_brand_mutation_forbidden" && error?.status === 403
  );
  assert.equal(executor.inserted.length, 0, "missing Brand grant must fail before asset insert");
}

{
  const executor = buildExecutor({ canonicalRows: brandAuthorityRow("tenant-b") });
  await assert.rejects(
    insert(executor),
    (error) => error?.code === "workspace_resource_cross_tenant" && error?.status === 403
  );
  assert.equal(executor.inserted.length, 0, "cross-tenant Brand reference must fail before asset insert");
}

{
  const executor = buildExecutor();
  await insert(executor, { actorId: "platform_admin" });
  assert.equal(executor.inserted[0][6], "brand-key");
  assert(!executor.calls.some((call) => call.sql.includes("FROM memberships m")), "platform admin path must retain its existing system authority boundary");
}

{
  const executor = buildExecutor();
  await insert(executor, { brandRef: "" });
  assert.equal(executor.inserted.length, 1);
  assert.equal(executor.inserted[0][6], null, "workspace-scoped assets without a Brand attachment must remain supported");
  assert(!executor.calls.some((call) => call.sql.includes("tenant_brand_links")), "unscoped asset create must not invent Brand authority work");
}

assert.throws(
  () => assertWorkspaceAssetBrandPatchSafe({ display_name: "Renamed", brand_ref: "brand-key" }),
  (error) => error?.code === "workspace_asset_brand_rebind_requires_governed_surface" && error?.status === 409
);
assert.doesNotThrow(() => assertWorkspaceAssetBrandPatchSafe({ display_name: "Renamed" }));

console.log("workspace asset Brand authority tests passed");
