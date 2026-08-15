import assert from "node:assert/strict";
import { resolveWorkspaceCanonicalBrandReference } from "./workspaceCanonicalBrandReference.js";

const BRAND_ID = "550e8400-e29b-41d4-a716-446655440000";
const V2_COLUMNS = [
  ["brands", "brand_id"], ["brands", "identity_status"], ["brands", "resource_revision"],
  ["tenant_brand_links", "brand_id"], ["tenant_brand_links", "relationship_status"],
  ["tenant_brand_links", "verification_status"], ["tenant_brand_links", "claim_id"],
].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));
const V2_TABLES = ["brand_identifiers", "brand_identity_aliases", "brand_claims", "brand_verification_evidence"].map((TABLE_NAME) => ({ TABLE_NAME }));

function v2Executor({ relationshipStatus = "active", linkStatus = "active" } = {}) {
  const queries = [];
  const brand = {
    brand_id: BRAND_ID,
    brand_name: "Acme",
    normalized_brand_name: "acme",
    target_key: "brand-acme-global",
    identity_status: "verified",
    resource_revision: 7,
    status: "active",
  };
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/information_schema\.COLUMNS/.test(sql)) return [V2_COLUMNS];
      if (/information_schema\.TABLES/.test(sql)) return [V2_TABLES];
      if (/FROM brands/.test(sql) && /brand_id IN/.test(sql)) return [[brand]];
      if (/FROM brands/.test(sql) && /WHERE brand_id=\?/.test(sql)) return [[brand]];
      if (/FROM tenant_brand_links/.test(sql) && /brand_id=\?/.test(sql)) {
        return [[{
          link_id: "link-a",
          tenant_id: "tenant-a",
          brand_id: BRAND_ID,
          brand_target_key: brand.target_key,
          relationship_type: "operator",
          relationship_status: relationshipStatus,
          verification_status: relationshipStatus === "active" ? "verified" : "pending",
          claim_id: relationshipStatus === "active" ? null : "claim-a",
          status: linkStatus,
          revision: 1,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function legacyExecutor() {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (/information_schema\.COLUMNS/.test(sql)) throw Object.assign(new Error("legacy"), { code: "ER_BAD_FIELD_ERROR" });
      if (/FROM brands b/.test(sql)) return [[{ target_key: "legacy-brand", brand_status: "active" }]];
      if (/FROM tenant_brand_links/.test(sql) && /LOWER\(brand_target_key\)/.test(sql)) {
        return [[{ tenant_id: "tenant-a", brand_target_key: "legacy-brand", link_status: "active" }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

{
  const db = v2Executor();
  const resolved = await resolveWorkspaceCanonicalBrandReference(db, {
    tenantId: "tenant-a",
    resourceRef: BRAND_ID,
    lock: true,
  });
  assert.equal(resolved.identity_mode, "global_identity_v2");
  assert.equal(resolved.brand_id, BRAND_ID);
  assert.equal(resolved.target_key, "brand-acme-global");
  assert.equal(resolved.relationship.relationship_status, "active");
}

{
  const db = legacyExecutor();
  const resolved = await resolveWorkspaceCanonicalBrandReference(db, {
    tenantId: "tenant-a",
    resourceRef: "legacy-brand",
    lock: true,
  });
  assert.equal(resolved.identity_mode, "legacy_compatibility");
  assert.equal(resolved.brand_id, null);
  assert.equal(resolved.target_key, "legacy-brand");
}

console.log("workspace canonical Brand reference tests passed");
