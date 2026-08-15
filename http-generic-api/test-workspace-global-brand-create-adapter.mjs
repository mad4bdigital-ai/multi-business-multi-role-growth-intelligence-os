import assert from "node:assert/strict";
import {
  prepareWorkspaceGlobalBrandForCreate,
  readGlobalBrandIdentitySchemaState,
} from "./workspaceGlobalBrandCreateAdapter.js";

function readySchemaColumns() {
  return [
    ["brands", "brand_id"],
    ["brands", "identity_status"],
    ["brands", "resource_revision"],
    ["tenant_brand_links", "brand_id"],
    ["tenant_brand_links", "relationship_status"],
    ["tenant_brand_links", "verification_status"],
    ["tenant_brand_links", "claim_id"],
  ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));
}

function buildExecutor({ linkedBrand = null } = {}) {
  const queries = [];
  let insertedBrand = null;
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/information_schema\.COLUMNS/.test(sql)) return [readySchemaColumns()];
      if (/information_schema\.TABLES/.test(sql)) {
        return [["brand_identifiers", "brand_identity_aliases", "brand_claims", "brand_verification_evidence"].map((TABLE_NAME) => ({ TABLE_NAME }))];
      }
      if (/FROM tenant_brand_links/.test(sql) && /brand_id IS NOT NULL/.test(sql)) {
        return [linkedBrand ? [{ link_id: "link-a", tenant_id: "tenant-a", brand_id: linkedBrand.brand_id, brand_target_key: linkedBrand.target_key, relationship_status: "active", verification_status: "verified", status: "active" }] : []];
      }
      if (/FROM brands/.test(sql) && /brand_id IN/.test(sql)) return [linkedBrand ? [linkedBrand] : []];
      if (/INSERT INTO brands/.test(sql)) {
        insertedBrand = {
          brand_id: params[0],
          brand_name: params[1],
          normalized_brand_name: params[2],
          target_key: params[3],
          identity_status: "provisional",
          resource_revision: 1,
          status: "active",
          brand_core_ready: null,
        };
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO brand_identifiers/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO brand_identity_aliases/.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM brands/.test(sql) && /WHERE brand_id=\?/.test(sql)) return [insertedBrand ? [insertedBrand] : []];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

{
  const executor = { async query() { throw Object.assign(new Error("legacy schema"), { code: "ER_BAD_FIELD_ERROR" }); } };
  const state = await readGlobalBrandIdentitySchemaState(executor);
  assert.equal(state.ready, false);
  assert.equal(state.source, "compatibility_fallback");
}

{
  const db = buildExecutor();
  const result = await prepareWorkspaceGlobalBrandForCreate(db, {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    displayName: "Acme Travel",
    normalizedName: "acme travel",
  });
  assert.equal(result.mode, "global_identity_v2");
  assert.equal(result.created, true);
  assert.match(result.brand.brand_id, /^[a-f0-9-]{36}$/);
  assert.match(result.brand.target_key, /^brand_[a-f0-9]{32}$/);
  assert.equal(db.queries.some((entry) => /INSERT INTO brand_identifiers/.test(entry.sql)), true);
  assert.equal(db.queries.some((entry) => /INSERT INTO brand_identity_aliases/.test(entry.sql)), true);
  assert.equal(db.queries.some((entry) => /workspace_resource_grants/.test(entry.sql)), false, "identity adapter must never mint authority grants");
}

{
  const linked = {
    brand_id: "550e8400-e29b-41d4-a716-446655440000",
    brand_name: "Acme Travel",
    normalized_brand_name: "acme travel",
    target_key: "brand_existing",
    identity_status: "verified",
    resource_revision: 4,
    status: "active",
    brand_core_ready: 1,
  };
  const db = buildExecutor({ linkedBrand: linked });
  const result = await prepareWorkspaceGlobalBrandForCreate(db, {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    displayName: " ACME  TRAVEL ",
    normalizedName: "acme travel",
  });
  assert.equal(result.created, false);
  assert.equal(result.brand.brand_id, linked.brand_id);
  assert.equal(db.queries.some((entry) => /INSERT INTO brands/.test(entry.sql)), false, "same-tenant retry must reuse global Brand identity");
}

console.log("workspace global Brand create adapter tests passed");
