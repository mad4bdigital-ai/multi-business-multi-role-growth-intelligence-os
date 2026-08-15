import { createHash } from "node:crypto";

export const BRAND_VERIFICATION_METHODS = Object.freeze([
  "dns_txt_challenge",
  "provider_oauth_proof",
  "provider_native_account_ownership",
  "website_challenge",
  "verified_owner_approval",
  "corporate_email_challenge",
  "legal_trademark_review",
  "manual_admin_verification",
]);

function claimError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function stableUuid(...parts) {
  const hex = createHash("sha256").update(parts.map((value) => String(value ?? "")).join("|"), "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const blocked = new Set(["secret", "token", "access_token", "refresh_token", "password", "credential", "authorization"]);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (blocked.has(String(key).toLowerCase())) continue;
    if (typeof item === "string") output[key] = item.slice(0, 2048);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) output[key] = item;
  }
  return output;
}

async function lockClaim(connection, claimId) {
  const [rows] = await connection.query(
    `SELECT claim_id, brand_id, claimant_tenant_id, claim_type, requested_relationship, status,
            expires_at, verified_at, revoked_at, revision
       FROM brand_claims
      WHERE claim_id=?
      LIMIT 2 FOR UPDATE`,
    [claimId]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw claimError(404, "brand_claim_not_found", "Brand claim was not found.");
  }
  if (rows.length !== 1) {
    throw claimError(409, "brand_claim_ambiguous", "Brand claim did not resolve uniquely.");
  }
  return rows[0];
}

function requireExpectedRevision(row, expectedRevision) {
  const expected = Number(expectedRevision);
  const actual = Number(row?.revision || 0);
  if (!Number.isInteger(expected) || expected < 1) {
    throw claimError(400, "brand_claim_expected_revision_required", "A positive expected_revision is required.");
  }
  if (actual !== expected) {
    throw claimError(409, "brand_claim_revision_conflict", "Brand claim revision changed.", [{ expected_revision: expected, actual_revision: actual }]);
  }
}

export function prepareBrandVerificationChallenge({
  claimId,
  method,
  domain = null,
  providerFamily = null,
} = {}) {
  const normalizedMethod = text(method, 64).toLowerCase();
  if (!BRAND_VERIFICATION_METHODS.includes(normalizedMethod)) {
    throw claimError(400, "brand_verification_method_invalid", "Unsupported Brand verification method.");
  }
  const claim = text(claimId, 64);
  if (!claim) throw claimError(400, "brand_claim_id_required", "claim_id is required.");
  const challengeRef = stableUuid("brand-verification-challenge", claim, normalizedMethod, text(domain), text(providerFamily));
  return {
    claim_id: claim,
    verification_method: normalizedMethod,
    challenge_ref: challengeRef,
    challenge_kind: normalizedMethod === "dns_txt_challenge"
      ? "dns_txt"
      : normalizedMethod.includes("provider") || normalizedMethod === "provider_oauth_proof"
        ? "provider_proof"
        : "governed_evidence",
    domain: domain ? text(domain, 255).toLowerCase() : null,
    provider_family: providerFamily ? text(providerFamily, 64).toLowerCase() : null,
    secrets_included: false,
  };
}

export async function recordBrandVerificationEvidence(connection, {
  claimId,
  method,
  evidenceType,
  evidenceRef = null,
  evidencePayload = null,
  metadata = {},
  verificationStatus = "pending",
  verifiedBy = null,
  validUntil = null,
} = {}) {
  const claim = await lockClaim(connection, claimId);
  const normalizedMethod = text(method, 64).toLowerCase();
  if (!BRAND_VERIFICATION_METHODS.includes(normalizedMethod)) {
    throw claimError(400, "brand_verification_method_invalid", "Unsupported Brand verification method.");
  }
  const type = text(evidenceType, 64);
  if (!type) throw claimError(400, "brand_verification_evidence_type_required", "evidence_type is required.");
  const allowedStatus = new Set(["pending", "verified", "rejected", "revoked", "expired"]);
  const status = text(verificationStatus, 32).toLowerCase();
  if (!allowedStatus.has(status)) {
    throw claimError(400, "brand_verification_status_invalid", "Invalid Brand verification evidence status.");
  }
  const evidenceHash = createHash("sha256")
    .update(JSON.stringify({
      claim_id: claim.claim_id,
      method: normalizedMethod,
      evidence_type: type,
      evidence_ref: text(evidenceRef, 191),
      payload: evidencePayload ?? null,
    }), "utf8")
    .digest("hex");
  const evidenceId = stableUuid("brand-verification-evidence", claim.claim_id, normalizedMethod, type, evidenceHash);
  await connection.query(
    `INSERT INTO brand_verification_evidence
      (evidence_id, claim_id, brand_id, tenant_id, verification_method, evidence_type,
       evidence_ref, evidence_hash, verification_status, metadata_json, valid_from, valid_until, verified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?)
     ON DUPLICATE KEY UPDATE
       verification_status=VALUES(verification_status),
       metadata_json=VALUES(metadata_json),
       valid_until=VALUES(valid_until),
       verified_by=VALUES(verified_by),
       updated_at=CURRENT_TIMESTAMP`,
    [
      evidenceId,
      claim.claim_id,
      claim.brand_id,
      claim.claimant_tenant_id,
      normalizedMethod,
      type,
      text(evidenceRef, 191) || null,
      evidenceHash,
      status,
      JSON.stringify({ ...safeMetadata(metadata), secrets_included: false }),
      validUntil || null,
      text(verifiedBy, 64) || null,
    ]
  );
  const [rows] = await connection.query(
    `SELECT evidence_id, claim_id, brand_id, tenant_id, verification_method, evidence_type,
            evidence_ref, evidence_hash, verification_status, valid_from, valid_until, verified_by
       FROM brand_verification_evidence
      WHERE evidence_id=?
      LIMIT 2 FOR UPDATE`,
    [evidenceId]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw claimError(409, "brand_verification_evidence_readback_invalid", "Brand verification evidence did not resolve exactly once.");
  }
  return { ...rows[0], secrets_included: false };
}

export async function verifyBrandClaim(connection, {
  claimId,
  expectedRevision,
  evidenceId,
  verifiedBy,
} = {}) {
  const claim = await lockClaim(connection, claimId);
  requireExpectedRevision(claim, expectedRevision);
  if (String(claim.status) === "verified") {
    return { claim, idempotent: true, authority_grant_mutated: false, secrets_included: false };
  }
  if (!["pending_verification", "disputed"].includes(String(claim.status))) {
    throw claimError(409, "brand_claim_not_verifiable", "Brand claim is not in a verifiable state.");
  }
  const [evidenceRows] = await connection.query(
    `SELECT evidence_id, claim_id, brand_id, tenant_id, verification_status, valid_until
       FROM brand_verification_evidence
      WHERE evidence_id=? AND claim_id=?
      LIMIT 2 FOR UPDATE`,
    [evidenceId, claim.claim_id]
  );
  if (!Array.isArray(evidenceRows) || evidenceRows.length !== 1 || String(evidenceRows[0].verification_status) !== "verified") {
    throw claimError(409, "brand_claim_verified_evidence_required", "Current verified evidence is required before a Brand claim can be verified.");
  }
  const evidence = evidenceRows[0];
  if (evidence.valid_until && new Date(evidence.valid_until).getTime() <= Date.now()) {
    throw claimError(409, "brand_claim_evidence_expired", "Brand claim verification evidence has expired.");
  }

  const [claimUpdate] = await connection.query(
    `UPDATE brand_claims
        SET status='verified', verified_at=UTC_TIMESTAMP(), revision=revision+1, updated_at=CURRENT_TIMESTAMP
      WHERE claim_id=? AND revision=? AND status IN ('pending_verification','disputed')`,
    [claim.claim_id, Number(expectedRevision)]
  );
  if (Number(claimUpdate?.affectedRows || 0) !== 1) {
    throw claimError(409, "brand_claim_revision_conflict", "Brand claim changed before verification could be committed.");
  }

  const [linkRows] = await connection.query(
    `SELECT link_id, status, relationship_status, verification_status, revision
       FROM tenant_brand_links
      WHERE tenant_id=? AND brand_id=? AND claim_id=?
      LIMIT 2 FOR UPDATE`,
    [claim.claimant_tenant_id, claim.brand_id, claim.claim_id]
  );
  if (!Array.isArray(linkRows) || linkRows.length !== 1) {
    throw claimError(409, "brand_claim_relationship_readback_invalid", "Claimed tenant-to-Brand relationship did not resolve exactly once.");
  }
  const [relationshipUpdate] = await connection.query(
    `UPDATE tenant_brand_links
        SET relationship_type=?,
            relationship_status='active',
            verification_status='verified',
            status='active',
            effective_from=COALESCE(effective_from, UTC_TIMESTAMP()),
            revision=revision+1,
            updated_at=CURRENT_TIMESTAMP
      WHERE link_id=? AND tenant_id=? AND brand_id=?`,
    [claim.requested_relationship, linkRows[0].link_id, claim.claimant_tenant_id, claim.brand_id]
  );
  if (Number(relationshipUpdate?.affectedRows || 0) !== 1) {
    throw claimError(409, "brand_claim_relationship_update_conflict", "Tenant-to-Brand relationship could not be activated exactly once.");
  }

  const verifiedClaim = await lockClaim(connection, claim.claim_id);
  return {
    claim: verifiedClaim,
    relationship: {
      tenant_id: claim.claimant_tenant_id,
      brand_id: claim.brand_id,
      relationship_type: claim.requested_relationship,
      relationship_status: "active",
      verification_status: "verified",
    },
    verified_by: text(verifiedBy, 64) || null,
    authority_grant_mutated: false,
    secrets_included: false,
  };
}

export async function revokeBrandClaim(connection, {
  claimId,
  expectedRevision,
  revokedBy,
  reason = null,
} = {}) {
  const claim = await lockClaim(connection, claimId);
  requireExpectedRevision(claim, expectedRevision);
  if (String(claim.status) === "revoked") {
    return { claim, idempotent: true, authority_grant_mutated: false, secrets_included: false };
  }
  const [result] = await connection.query(
    `UPDATE brand_claims
        SET status='revoked', revoked_at=UTC_TIMESTAMP(), revision=revision+1,
            evidence_summary_json=JSON_SET(COALESCE(evidence_summary_json, JSON_OBJECT()),
              '$.revocation_reason', ?, '$.revoked_by', ?),
            updated_at=CURRENT_TIMESTAMP
      WHERE claim_id=? AND revision=?`,
    [text(reason, 500) || null, text(revokedBy, 64) || null, claim.claim_id, Number(expectedRevision)]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw claimError(409, "brand_claim_revision_conflict", "Brand claim changed before revocation could be committed.");
  }
  await connection.query(
    `UPDATE tenant_brand_links
        SET relationship_status='revoked', verification_status='revoked', status='inactive',
            effective_until=UTC_TIMESTAMP(), revision=revision+1, updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND brand_id=? AND claim_id=?`,
    [claim.claimant_tenant_id, claim.brand_id, claim.claim_id]
  );
  return {
    claim: await lockClaim(connection, claim.claim_id),
    authority_grant_mutated: false,
    finding_if_grants_remain: "archived_relationship_with_active_grants",
    secrets_included: false,
  };
}

export const _testingBrandClaimVerification = Object.freeze({
  text,
  stableUuid,
  safeMetadata,
  requireExpectedRevision,
});
