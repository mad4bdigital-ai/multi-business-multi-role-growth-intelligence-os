import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import {
  normalizeBrandInputIdentifiers,
  publicPersistentBrandIdentityResolution,
  resolvePersistentBrandIdentity,
} from "./brandIdentityResolver.js";
import {
  prepareBrandVerificationChallenge,
  recordBrandVerificationEvidence,
  revokeBrandClaim,
} from "./brandClaimVerification.js";
import { readGlobalBrandIdentitySchemaState } from "./workspaceGlobalBrandCreateAdapter.js";

const OWNER_ROLES = new Set(["owner", "admin"]);
const CLAIM_RELATIONSHIP_TYPES = new Set([
  "owner",
  "operator",
  "manager",
  "agency",
  "partner",
  "representative",
  "franchise",
  "licensee",
  "client",
]);

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function claimServiceError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function stableUuid(...parts) {
  const hex = createHash("sha256")
    .update(parts.map((value) => String(value ?? "")).join("|"), "utf8")
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function requireWorkspaceOwner(connection, tenantId, actorUserId) {
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.user_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, actorUserId]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw claimServiceError(403, "brand_claim_workspace_owner_required", "Active workspace owner/admin membership is required.");
  }
  const membership = rows[0];
  if (
    String(membership.status || "").toLowerCase() !== "active"
    || String(membership.tenant_status || "").toLowerCase() !== "active"
    || !OWNER_ROLES.has(String(membership.role || "").toLowerCase())
  ) {
    throw claimServiceError(403, "brand_claim_workspace_owner_required", "Active workspace owner/admin membership is required.");
  }
  return membership;
}

function normalizeRelationshipType(value) {
  const type = text(value || "operator", 32).toLowerCase();
  if (!CLAIM_RELATIONSHIP_TYPES.has(type)) {
    throw claimServiceError(400, "brand_claim_relationship_type_invalid", "Unsupported Tenant-to-Brand relationship type.");
  }
  return type;
}

async function requireIdentitySchema(connection) {
  const state = await readGlobalBrandIdentitySchemaState(connection);
  if (!state.ready) {
    throw claimServiceError(409, "brand_identity_schema_not_ready", "Global Brand identity schema is not ready for claim operations.", state.missing);
  }
  return state;
}

async function readBrandById(connection, brandId) {
  const [rows] = await connection.query(
    `SELECT brand_id, brand_name, normalized_brand_name, target_key, identity_status, resource_revision, status
       FROM brands
      WHERE brand_id=?
      LIMIT 2 FOR UPDATE`,
    [brandId]
  );
  if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0].status || "").toLowerCase() !== "active") {
    throw claimServiceError(404, "brand_claim_target_not_found", "Canonical Brand was not found or is inactive.");
  }
  return rows[0];
}

async function resolveClaimTarget(connection, input = {}) {
  const directBrandId = text(input.brand_id, 64);
  const identifiers = normalizeBrandInputIdentifiers({
    brandDomain: input.brand_domain || input.domain || null,
    canonicalUrl: input.canonical_url || input.base_url || null,
    brandName: input.brand_name || input.display_name || null,
    identifiers: input.identifiers || [],
  });
  const resolution = await resolvePersistentBrandIdentity(connection, {
    brandId: directBrandId || null,
    identifiers,
    aliases: Array.isArray(input.aliases) ? input.aliases : [],
    lock: true,
  });
  if (resolution.status !== "EXACT" || !resolution.brand_id) {
    const status = resolution.status === "CONFLICT" || resolution.status === "AMBIGUOUS" ? 409 : 422;
    throw claimServiceError(
      status,
      `brand_claim_identity_${String(resolution.status || "NONE").toLowerCase()}`,
      "Brand claim requires one exact canonical identity before relationship verification can begin.",
      [publicPersistentBrandIdentityResolution(resolution)]
    );
  }
  return {
    resolution: publicPersistentBrandIdentityResolution(resolution),
    brand: await readBrandById(connection, resolution.brand_id),
  };
}

async function readActiveTenantRelationship(connection, tenantId, brandId) {
  const [rows] = await connection.query(
    `SELECT link_id, tenant_id, brand_id, brand_target_key, relationship_type, relationship_status,
            verification_status, claim_id, status, revision
       FROM tenant_brand_links
      WHERE tenant_id=? AND brand_id=? AND status='active' AND relationship_status='active'
      LIMIT 3 FOR UPDATE`,
    [tenantId, brandId]
  );
  if (Array.isArray(rows) && rows.length > 1) {
    throw claimServiceError(409, "brand_claim_relationship_ambiguous", "Tenant-to-Brand relationship resolves to multiple active rows.");
  }
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertPendingClaim(connection, {
  tenantId,
  actorUserId,
  brand,
  relationshipType,
  claimType,
  evidenceSummary = null,
}) {
  const claimId = stableUuid("brand-claim", tenantId, brand.brand_id, relationshipType);
  const linkId = stableUuid("tenant-brand-claim-link", tenantId, brand.brand_id, relationshipType);
  const metadata = JSON.stringify({
    authority_implied: false,
    authority_source: "separate_workspace_resource_grant",
    relationship_source: "brand_claim_request",
    secrets_included: false,
  });

  await connection.query(
    `INSERT INTO brand_claims
      (claim_id, brand_id, claimant_tenant_id, claim_type, requested_relationship, status,
       created_by, evidence_summary_json, revision)
     VALUES (?, ?, ?, ?, ?, 'pending_verification', ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       evidence_summary_json=COALESCE(VALUES(evidence_summary_json), evidence_summary_json),
       updated_at=CURRENT_TIMESTAMP`,
    [
      claimId,
      brand.brand_id,
      tenantId,
      claimType,
      relationshipType,
      actorUserId,
      evidenceSummary ? JSON.stringify(evidenceSummary) : null,
    ]
  );

  const [claimRows] = await connection.query(
    `SELECT claim_id, brand_id, claimant_tenant_id, claim_type, requested_relationship, status,
            expires_at, verified_at, revoked_at, revision, created_at, updated_at
       FROM brand_claims
      WHERE claim_id=?
      LIMIT 2 FOR UPDATE`,
    [claimId]
  );
  if (!Array.isArray(claimRows) || claimRows.length !== 1) {
    throw claimServiceError(409, "brand_claim_readback_invalid", "Pending Brand claim did not resolve exactly once.");
  }
  const claim = claimRows[0];
  if (!["pending_verification", "disputed"].includes(String(claim.status))) {
    throw claimServiceError(409, "brand_claim_state_conflict", "Existing Brand claim is not pending verification.", [{ status: claim.status }]);
  }

  await connection.query(
    `INSERT INTO tenant_brand_links
      (link_id, tenant_id, brand_id, brand_target_key, relationship_type, relationship_status,
       verification_status, claim_id, relationship_source, link_source, status, metadata_json, revision)
     VALUES (?, ?, ?, ?, ?, 'pending_verification', 'pending', ?, 'brand_claim_request', 'brand_claim_request', 'inactive', ?, 1)
     ON DUPLICATE KEY UPDATE
       brand_id=VALUES(brand_id),
       relationship_type=VALUES(relationship_type),
       relationship_status='pending_verification',
       verification_status='pending',
       claim_id=VALUES(claim_id),
       relationship_source='brand_claim_request',
       link_source='brand_claim_request',
       metadata_json=VALUES(metadata_json),
       revision=revision,
       updated_at=CURRENT_TIMESTAMP`,
    [linkId, tenantId, brand.brand_id, brand.target_key, relationshipType, claimId, metadata]
  );

  const [linkRows] = await connection.query(
    `SELECT link_id, tenant_id, brand_id, brand_target_key, relationship_type, relationship_status,
            verification_status, claim_id, relationship_source, status, revision
       FROM tenant_brand_links
      WHERE tenant_id=? AND brand_id=? AND claim_id=?
      LIMIT 2 FOR UPDATE`,
    [tenantId, brand.brand_id, claimId]
  );
  if (!Array.isArray(linkRows) || linkRows.length !== 1) {
    throw claimServiceError(409, "brand_claim_relationship_readback_invalid", "Pending Tenant-to-Brand relationship did not resolve exactly once.");
  }

  return {
    claim,
    relationship: linkRows[0],
    authority_grant_created: false,
    authority_epoch_advanced: false,
    secrets_included: false,
  };
}

export async function requestBrandClaim({
  tenantId,
  actorUserId,
  input = {},
  pool = getPool(),
} = {}) {
  const tenant = text(tenantId, 64);
  const actor = text(actorUserId, 64);
  if (!tenant || !actor) throw claimServiceError(400, "brand_claim_identity_required", "Tenant and signed-in user are required.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await requireIdentitySchema(connection);
    await requireWorkspaceOwner(connection, tenant, actor);
    const relationshipType = normalizeRelationshipType(input.relationship_type || input.requested_relationship);
    const { resolution, brand } = await resolveClaimTarget(connection, input);
    const active = await readActiveTenantRelationship(connection, tenant, brand.brand_id);
    if (active) {
      await connection.commit();
      return {
        created: false,
        status: "already_linked",
        identity_resolution: resolution,
        relationship: active,
        claim: null,
        authority_grant_created: false,
        authority_epoch_advanced: false,
        secrets_included: false,
      };
    }
    const pending = await upsertPendingClaim(connection, {
      tenantId: tenant,
      actorUserId: actor,
      brand,
      relationshipType,
      claimType: text(input.claim_type || relationshipType, 32).toLowerCase(),
      evidenceSummary: input.evidence_summary && typeof input.evidence_summary === "object" ? input.evidence_summary : null,
    });
    await connection.commit();
    return {
      created: true,
      status: "pending_verification",
      identity_resolution: resolution,
      canonical_brand: {
        brand_id: brand.brand_id,
        target_key: brand.target_key,
        identity_status: brand.identity_status,
        resource_revision: Number(brand.resource_revision || 1),
      },
      ...pending,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listBrandClaims({ tenantId, actorUserId, pool = getPool() } = {}) {
  const tenant = text(tenantId, 64);
  const actor = text(actorUserId, 64);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await requireIdentitySchema(connection);
    await requireWorkspaceOwner(connection, tenant, actor);
    const [rows] = await connection.query(
      `SELECT claim_id, brand_id, claim_type, requested_relationship, status, expires_at,
              verified_at, revoked_at, revision, created_at, updated_at
         FROM brand_claims
        WHERE claimant_tenant_id=?
        ORDER BY updated_at DESC, claim_id ASC
        LIMIT 200`,
      [tenant]
    );
    await connection.commit();
    return { claims: Array.isArray(rows) ? rows : [], count: Array.isArray(rows) ? rows.length : 0, secrets_included: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function prepareClaimChallenge({ tenantId, actorUserId, claimId, input = {}, pool = getPool() } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await requireIdentitySchema(connection);
    await requireWorkspaceOwner(connection, text(tenantId, 64), text(actorUserId, 64));
    const [rows] = await connection.query(
      `SELECT claim_id, claimant_tenant_id, status
         FROM brand_claims
        WHERE claim_id=? AND claimant_tenant_id=?
        LIMIT 2 FOR UPDATE`,
      [claimId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length !== 1 || !["pending_verification", "disputed"].includes(String(rows[0].status))) {
      throw claimServiceError(404, "brand_claim_not_pending", "Pending Brand claim was not found for this workspace.");
    }
    const challenge = prepareBrandVerificationChallenge({
      claimId,
      method: input.method,
      domain: input.domain || null,
      providerFamily: input.provider_family || null,
    });
    await connection.commit();
    return challenge;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function submitClaimEvidence({ tenantId, actorUserId, claimId, input = {}, pool = getPool() } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await requireIdentitySchema(connection);
    await requireWorkspaceOwner(connection, text(tenantId, 64), text(actorUserId, 64));
    const [rows] = await connection.query(
      `SELECT claim_id, claimant_tenant_id, status
         FROM brand_claims
        WHERE claim_id=? AND claimant_tenant_id=?
        LIMIT 2 FOR UPDATE`,
      [claimId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length !== 1 || !["pending_verification", "disputed"].includes(String(rows[0].status))) {
      throw claimServiceError(404, "brand_claim_not_pending", "Pending Brand claim was not found for this workspace.");
    }
    const evidence = await recordBrandVerificationEvidence(connection, {
      claimId,
      method: input.method,
      evidenceType: input.evidence_type,
      evidenceRef: input.evidence_ref || null,
      evidencePayload: input.evidence_payload ?? null,
      metadata: input.metadata || {},
      verificationStatus: "pending",
      verifiedBy: null,
      validUntil: input.valid_until || null,
    });
    await connection.commit();
    return {
      evidence,
      verification_status: "pending",
      self_verification_allowed: false,
      authority_grant_created: false,
      secrets_included: false,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revokeWorkspaceBrandClaim({ tenantId, actorUserId, claimId, input = {}, pool = getPool() } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await requireIdentitySchema(connection);
    await requireWorkspaceOwner(connection, text(tenantId, 64), text(actorUserId, 64));
    const [rows] = await connection.query(
      `SELECT claim_id, claimant_tenant_id
         FROM brand_claims
        WHERE claim_id=? AND claimant_tenant_id=?
        LIMIT 2 FOR UPDATE`,
      [claimId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw claimServiceError(404, "brand_claim_not_found", "Brand claim was not found for this workspace.");
    }
    const result = await revokeBrandClaim(connection, {
      claimId,
      expectedRevision: input.expected_revision,
      revokedBy: actorUserId,
      reason: input.reason || null,
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const _testingBrandClaimService = Object.freeze({
  OWNER_ROLES,
  CLAIM_RELATIONSHIP_TYPES,
  stableUuid,
  normalizeRelationshipType,
  resolveClaimTarget,
  upsertPendingClaim,
});
