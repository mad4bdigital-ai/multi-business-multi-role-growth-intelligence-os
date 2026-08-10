import assert from "node:assert/strict";
import { resolveWorkspaceBrandReadAuthority } from "./workspaceBrandReadAuthority.js";

function executor(resultSets) {
  const queue = [...resultSets];
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return [queue.shift() || []];
    },
  };
}

{
  const pool = executor([
    [{ link_id: "link-a", tenant_id: "tenant-a", brand_target_key: "brand-a", status: "active" }],
    [{ user_id: "user-a", tenant_id: "tenant-a", role: "owner", status: "active", tenant_status: "active" }],
    [{ workspace_id: "brand-workspace-a", workspace_key: "brand:a", workspace_type: "brand", bootstrap_status: "ready", linked_brand_key: "brand-a" }],
  ]);
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-a",
    brandRef: "brand-a",
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authority_source, "tenant_owner_membership");
  assert.equal(result.canonical_brand_ref, "brand-a");
  assert.equal(result.resource_grant_present, false);
  assert.equal(pool.queries.length, 3);
}

{
  const pool = executor([
    [{ link_id: "link-b", tenant_id: "tenant-a", brand_target_key: "brand-b", status: "active" }],
    [{ user_id: "user-b", tenant_id: "tenant-a", role: "member", status: "active", tenant_status: "active" }],
    [{ workspace_id: "brand-workspace-b", workspace_key: "brand:b", workspace_type: "brand", bootstrap_status: "ready", linked_brand_key: "brand-b" }],
    [{ grant_id: "grant-b", permission: "view", grant_status: "active", membership_status: "active" }],
  ]);
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-b",
    brandRef: "brand-b",
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authority_source, "workspace_resource_grant");
  assert.equal(result.resource_grant_present, true);
  assert.equal(result.grant_id, "grant-b");
  assert.equal(result.permission, "view");
}

{
  const pool = executor([
    [{ link_id: "link-c", tenant_id: "tenant-a", brand_target_key: "brand-c", status: "active" }],
    [{ user_id: "user-c", tenant_id: "tenant-a", role: "member", status: "active", tenant_status: "active" }],
    [],
    [],
  ]);
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-c",
    brandRef: "brand-c",
  });
  assert.equal(result.authorized, false);
  assert.equal(result.status, "tenant_brand_authority_missing");
  assert.equal(result.resource_grant_present, false);
}

console.log("workspace Brand read authority tests passed");
