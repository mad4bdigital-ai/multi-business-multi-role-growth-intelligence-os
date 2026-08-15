import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { requestBrandClaim } from "./brandClaimService.js";

const brand = {
  brand_id: "550e8400-e29b-41d4-a716-446655440000",
  brand_name: "Acme Travel",
  normalized_brand_name: "acme travel",
  target_key: "brand_acme_global",
  identity_status: "verified",
  resource_revision: 3,
  status: "active",
};

function readySchemaColumns() {
  return [
    ["brands", "brand_id"], ["brands", "identity_status"], ["brands", "resource_revision"],
    ["tenant_brand_links", "brand_id"], ["tenant_brand_links", "relationship_status"],
    ["tenant_brand_links", "verification_status"], ["tenant_brand_links", "claim_id"],
  ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));
}

function buildPool() {
  const queries = [];
  let claim = null;
  let relationship = null;
  const connection = {
    async beginTransaction() { queries.push({ sql: "BEGIN", params: [] }); },
    async commit() { queries.push({ sql: "COMMIT", params: [] }); },
    async rollback() { queries.push({ sql: "ROLLBACK", params: [] }); },
    release() { queries.push({ sql: "RELEASE", params: [] }); },
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/information_schema\.COLUMNS/.test(sql)) return [readySchemaColumns()];
      if (/information_schema\.TABLES/.test(sql)) return [["brand_identifiers", "brand_identity_aliases", "brand_claims", "brand_verification_evidence"].map((TABLE_NAME) => ({ TABLE_NAME }))];
      if (/FROM memberships m/.test(sql)) return [[{ user_id: "user-a", tenant_id: "tenant-a", role: "owner", status: "active", tenant_status: "active" }]];
      if (/FROM brands/.test(sql) && /brand_id IN/.test(sql)) return [[brand]];
      if (/FROM brands/.test(sql) && /WHERE brand_id=\?/.test(sql)) return [[brand]];
      if (/FROM tenant_brand_links/.test(sql) && /relationship_status='active'/.test(sql)) return [[]];
      if (/INSERT INTO brand_claims/.test(sql)) {
        claim = {
          claim_id: params[0], brand_id: params[1], claimant_tenant_id: params[2], claim_type: params[3],
          requested_relationship: params[4], status: "pending_verification", expires_at: null,
          verified_at: null, revoked_at: null, revision: 1, created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-15T00:00:00Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (/FROM brand_claims/.test(sql) && /WHERE claim_id=\?/.test(sql)) return [claim ? [claim] : []];
      if (/INSERT INTO tenant_brand_links/.test(sql)) {
        relationship = {
          link_id: params[0], tenant_id: params[1], brand_id: params[2], brand_target_key: params[3],
          relationship_type: params[4], relationship_status: "pending_verification", verification_status: "pending",
          claim_id: params[5], relationship_source: "brand_claim_request", status: "inactive", revision: 1,
        };
        return [{ affectedRows: 1 }];
      }
      if (/FROM tenant_brand_links/.test(sql) && /claim_id=\?/.test(sql)) return [relationship ? [relationship] : []];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { queries, pool: { async getConnection() { return connection; } } };
}

const { queries, pool } = buildPool();
const result = await requestBrandClaim({
  tenantId: "tenant-a",
  actorUserId: "user-a",
  input: { brand_id: brand.brand_id, relationship_type: "operator" },
  pool,
});
assert.equal(result.created, true);
assert.equal(result.status, "pending_verification");
assert.equal(result.identity_resolution.status, "EXACT");
assert.equal(result.claim.status, "pending_verification");
assert.equal(result.relationship.status, "inactive");
assert.equal(result.relationship.relationship_status, "pending_verification");
assert.equal(result.authority_grant_created, false);
assert.equal(result.authority_epoch_advanced, false);
assert.equal(queries.some((entry) => /workspace_resource_grants/.test(entry.sql)), false, "claim request must not mint grants");
assert.equal(queries.some((entry) => /container_authority_epochs/.test(entry.sql)), false, "claim request must not advance container authority epoch");
assert.equal(queries.some((entry) => /^COMMIT$/.test(entry.sql)), true);

const routeSource = await fs.readFile(new URL("./routes/brandSkillRoutes.js", import.meta.url), "utf8");
assert.doesNotMatch(routeSource, /workspace_brand_claim_request/, "Spec 020 claim service remains library-only");
assert.doesNotMatch(routeSource, /\/me\/workspaces\/:tenant_id\/brand-claims/, "Spec 020 claim routes remain disabled");
assert.doesNotMatch(routeSource, /from \"\.\.\/brandClaimService\.js\"/, "Spec 020 claim service is not wired into runtime routes");
assert.doesNotMatch(routeSource, /requestBrandClaim|listBrandClaims|prepareClaimChallenge|submitClaimEvidence|revokeWorkspaceBrandClaim/, "Spec 020 claim operations remain shadow-only");

console.log("Brand claim request service tests passed");
