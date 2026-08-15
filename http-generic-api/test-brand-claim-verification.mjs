import assert from "node:assert/strict";
import {
  BRAND_VERIFICATION_METHODS,
  prepareBrandVerificationChallenge,
  recordBrandVerificationEvidence,
  revokeBrandClaim,
  verifyBrandClaim,
} from "./brandClaimVerification.js";

function buildConnection() {
  const state = {
    claim: {
      claim_id: "claim-1",
      brand_id: "brand-1",
      claimant_tenant_id: "tenant-a",
      claim_type: "owner",
      requested_relationship: "owner",
      status: "pending_verification",
      expires_at: null,
      verified_at: null,
      revoked_at: null,
      revision: 1,
    },
    evidence: null,
    relationship: {
      link_id: "link-1",
      tenant_id: "tenant-a",
      brand_id: "brand-1",
      claim_id: "claim-1",
      status: "inactive",
      relationship_status: "pending_verification",
      verification_status: "pending",
      revision: 1,
    },
  };
  const queries = [];
  return {
    state,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM brand_claims/.test(sql) && /WHERE claim_id=\?/.test(sql)) {
        return [state.claim && state.claim.claim_id === params[0] ? [{ ...state.claim }] : []];
      }
      if (/INSERT INTO brand_verification_evidence/.test(sql)) {
        state.evidence = {
          evidence_id: params[0],
          claim_id: params[1],
          brand_id: params[2],
          tenant_id: params[3],
          verification_method: params[4],
          evidence_type: params[5],
          evidence_ref: params[6],
          evidence_hash: params[7],
          verification_status: params[8],
          valid_from: new Date().toISOString(),
          valid_until: params[10],
          verified_by: params[11],
        };
        return [{ affectedRows: 1 }];
      }
      if (/FROM brand_verification_evidence/.test(sql) && /WHERE evidence_id=\?/.test(sql) && /claim_id=\?/.test(sql)) {
        return [state.evidence && state.evidence.evidence_id === params[0] && state.evidence.claim_id === params[1] ? [{ ...state.evidence }] : []];
      }
      if (/FROM brand_verification_evidence/.test(sql) && /WHERE evidence_id=\?/.test(sql)) {
        return [state.evidence && state.evidence.evidence_id === params[0] ? [{ ...state.evidence }] : []];
      }
      if (/UPDATE brand_claims/.test(sql) && /status='verified'/.test(sql)) {
        if (state.claim.revision !== params[1]) return [{ affectedRows: 0 }];
        state.claim.status = "verified";
        state.claim.verified_at = new Date().toISOString();
        state.claim.revision += 1;
        return [{ affectedRows: 1 }];
      }
      if (/FROM tenant_brand_links/.test(sql)) return [[{ ...state.relationship }]];
      if (/UPDATE tenant_brand_links/.test(sql) && /relationship_status='active'/.test(sql)) {
        state.relationship.relationship_type = params[0];
        state.relationship.relationship_status = "active";
        state.relationship.verification_status = "verified";
        state.relationship.status = "active";
        state.relationship.revision += 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE brand_claims/.test(sql) && /status='revoked'/.test(sql)) {
        if (state.claim.revision !== params[3]) return [{ affectedRows: 0 }];
        state.claim.status = "revoked";
        state.claim.revoked_at = new Date().toISOString();
        state.claim.revision += 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE tenant_brand_links/.test(sql) && /relationship_status='revoked'/.test(sql)) {
        state.relationship.relationship_status = "revoked";
        state.relationship.verification_status = "revoked";
        state.relationship.status = "inactive";
        state.relationship.revision += 1;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

assert.ok(BRAND_VERIFICATION_METHODS.includes("dns_txt_challenge"));
const challenge = prepareBrandVerificationChallenge({
  claimId: "claim-1",
  method: "dns_txt_challenge",
  domain: "example.com",
});
assert.equal(challenge.challenge_kind, "dns_txt");
assert.equal(challenge.secrets_included, false);

const connection = buildConnection();
const evidence = await recordBrandVerificationEvidence(connection, {
  claimId: "claim-1",
  method: "dns_txt_challenge",
  evidenceType: "dns_txt_observation",
  evidenceRef: "dns-check-1",
  evidencePayload: { txt_present: true },
  metadata: { host: "_growthos.example.com", token: "must-not-be-stored" },
  verificationStatus: "verified",
  verifiedBy: "governed-verifier",
});
assert.equal(evidence.verification_status, "verified");
const evidenceInsert = connection.queries.find((entry) => /INSERT INTO brand_verification_evidence/.test(entry.sql));
assert.equal(String(evidenceInsert.params[9]).includes("must-not-be-stored"), false, "secret-like metadata keys must be removed");

const verified = await verifyBrandClaim(connection, {
  claimId: "claim-1",
  expectedRevision: 1,
  evidenceId: evidence.evidence_id,
  verifiedBy: "governed-verifier",
});
assert.equal(verified.claim.status, "verified");
assert.equal(verified.relationship.relationship_status, "active");
assert.equal(verified.authority_grant_mutated, false, "relationship verification must not silently create authority grants");

await assert.rejects(
  () => verifyBrandClaim(connection, {
    claimId: "claim-1",
    expectedRevision: 1,
    evidenceId: evidence.evidence_id,
    verifiedBy: "governed-verifier",
  }),
  (error) => error?.code === "brand_claim_revision_conflict",
  "stale claim revision must fail closed"
);

const revoked = await revokeBrandClaim(connection, {
  claimId: "claim-1",
  expectedRevision: 2,
  revokedBy: "governed-verifier",
  reason: "relationship withdrawn",
});
assert.equal(revoked.claim.status, "revoked");
assert.equal(connection.state.relationship.status, "inactive");
assert.equal(revoked.authority_grant_mutated, false);
assert.equal(revoked.finding_if_grants_remain, "archived_relationship_with_active_grants");

console.log("brand claim verification contract: ok");
