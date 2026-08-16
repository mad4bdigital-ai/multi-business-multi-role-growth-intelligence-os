import assert from "node:assert/strict";
import { resolveWorkspaceBrandReadAuthority } from "./workspaceBrandReadAuthority.js";

const V2_COLUMNS = [
  ["brands", "brand_id"], ["brands", "identity_status"], ["brands", "resource_revision"],
  ["tenant_brand_links", "brand_id"], ["tenant_brand_links", "relationship_status"],
  ["tenant_brand_links", "verification_status"], ["tenant_brand_links", "claim_id"],
].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));
const V2_TABLES = ["brand_identifiers", "brand_identity_aliases", "brand_claims", "brand_verification_evidence"].map((TABLE_NAME) => ({ TABLE_NAME }));

function executor({ mode = "legacy", role = "owner", grant = null, workspaceReady = true } = {}) {
  const queries = [];
  const brand = {
    brand_id: "550e8400-e29b-41d4-a716-446655440000",
    brand_name: "Acme",
    normalized_brand_name: "acme",
    target_key: "brand-a",
    identity_status: "verified",
    resource_revision: 2,
    status: "active",
  };
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/information_schema\.COLUMNS/.test(sql)) {
        if (mode === "legacy") throw Object.assign(new Error("legacy schema"), { code: "ER_BAD_FIELD_ERROR" });
        return [V2_COLUMNS];
      }
      if (/information_schema\.TABLES/.test(sql)) return [V2_TABLES];
      if (/FROM brands/.test(sql) && /brand_id IN/.test(sql)) return [[brand]];
      if (/FROM brands/.test(sql) && /WHERE brand_id=\?/.test(sql)) return [[brand]];
      if (/FROM brands b/.test(sql)) return [[{ target_key: "brand-a", brand_status: "active" }]];
      if (/FROM tenant_brand_links/.test(sql) && /brand_id=\?/.test(sql)) {
        return [[{ link_id: "link-a", tenant_id: "tenant-a", brand_id: brand.brand_id, brand_target_key: "brand-a", relationship_type: "operator", relationship_status: "active", verification_status: "verified", status: "active", revision: 1 }]];
      }
      if (/FROM tenant_brand_links/.test(sql) && /LOWER\(brand_target_key\)/.test(sql)) {
        return [[{ tenant_id: "tenant-a", brand_target_key: "brand-a", link_status: "active" }]];
      }
      if (/FROM memberships m/.test(sql)) {
        return [[{ user_id: "user-a", tenant_id: "tenant-a", role, status: "active", tenant_status: "active" }]];
      }
      if (/FROM workspace_registry/.test(sql)) {
        return [workspaceReady ? [{ workspace_id: "brand-workspace-a", workspace_key: "brand:a", workspace_type: "brand", bootstrap_status: "ready", linked_brand_key: "brand-a" }] : []];
      }
      if (/FROM v_workspace_resource_grant_effective/.test(sql)) return [grant ? [grant] : []];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

{
  const pool = executor({ mode: "legacy", role: "owner" });
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-a",
    brandRef: "brand-a",
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authority_source, "tenant_owner_membership");
  assert.equal(result.canonical_brand_ref, "brand-a");
  assert.equal(result.canonical_brand_id, null);
  assert.equal(result.identity_mode, "legacy_compatibility");
  assert.equal(result.resource_grant_present, false);
}

{
  const pool = executor({ mode: "v2", role: "owner" });
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-a",
    brandRef: "550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal(result.authorized, true);
  assert.equal(result.canonical_brand_id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(result.canonical_brand_ref, "brand-a");
  assert.equal(result.identity_mode, "global_identity_v2");
  assert.equal(result.authority_source, "tenant_owner_membership");
}

{
  const pool = executor({
    mode: "v2",
    role: "member",
    grant: { grant_id: "grant-b", permission: "view", grant_status: "active", membership_status: "active" },
  });
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-a",
    brandRef: "550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authority_source, "workspace_resource_grant");
  assert.equal(result.resource_grant_present, true);
  assert.equal(result.grant_id, "grant-b");
  assert.equal(result.permission, "view");
}

{
  const pool = executor({ mode: "v2", role: "member", grant: null, workspaceReady: false });
  const result = await resolveWorkspaceBrandReadAuthority(pool, {
    tenantId: "tenant-a",
    userId: "user-a",
    brandRef: "550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal(result.authorized, false);
  assert.equal(result.status, "tenant_brand_authority_missing");
  assert.equal(result.resource_grant_present, false);
}

console.log("workspace Brand read authority tests passed");
