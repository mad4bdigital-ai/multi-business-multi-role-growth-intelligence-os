import {
  resolveBrandIdentity,
  validateIdentityDescriptor,
  validateResourceRelationship,
} from "./platformResourceIdentityContract.js";

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function tenantVisibleCandidate(candidate, tenantId) {
  const candidateTenant = text(candidate.tenant_id, 64);
  const requestedTenant = text(tenantId, 64);
  if (!requestedTenant) return { ...candidate, tenant_id: undefined };
  if (!candidateTenant || candidateTenant === requestedTenant) return { ...candidate, tenant_id: undefined };
  return null;
}

export function buildBrandIdentityCandidate({ brandId, tenantId, identifiers = [], status = "active", revision = 1 } = {}) {
  const descriptor = validateIdentityDescriptor({
    resource_type: "brand",
    identity_scope: "global",
    canonical_id: brandId,
    revision,
    status,
    authority_implied: false,
  });
  if (!descriptor.valid) {
    throw Object.assign(new TypeError("Invalid Brand identity candidate"), { code: "brand_identity_candidate_invalid", details: descriptor.errors });
  }
  return Object.freeze({
    brand_id: descriptor.normalized.canonical_id,
    tenant_id: text(tenantId, 64) || null,
    identifiers: Array.isArray(identifiers) ? identifiers : [],
    status: text(status, 32).toLowerCase() || "active",
    revision: descriptor.normalized.revision,
  });
}

export function resolveVisibleBrandIdentity({ tenantId, identifiers = [], candidates = [] } = {}) {
  const visibleCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => tenantVisibleCandidate(candidate, tenantId))
    .filter(Boolean)
    .filter((candidate) => !["archived", "disabled", "inactive"].includes(text(candidate.status, 32).toLowerCase()));

  const resolution = resolveBrandIdentity({
    identifiers,
    candidates: visibleCandidates,
  });

  // The resolver returns only identity-safe summaries; tenant ownership is never exposed.
  return Object.freeze({
    ...resolution,
    tenant_scope: text(tenantId, 64) || null,
    disclosure_policy: "identity_result_only",
    authority_required: true,
  });
}

export function buildTenantBrandRelationship({ tenantId, brandId, relationshipType = "references", revision = 1 } = {}) {
  const relationship = validateResourceRelationship({
    relationship_type: relationshipType,
    from_resource_id: text(tenantId, 64),
    to_resource_id: text(brandId, 128),
    tenant_id: tenantId,
    revision,
    authority_implied: false,
  });
  if (!relationship.valid) {
    throw Object.assign(new TypeError("Invalid Tenant-to-Brand relationship"), { code: "tenant_brand_relationship_invalid", details: relationship.errors });
  }
  return Object.freeze({
    ...relationship.normalized,
    authority_source: "separate_grant_and_policy_required",
    grant_created: false,
  });
}

export const _testingBrandIdentityResolver = Object.freeze({ tenantVisibleCandidate });
