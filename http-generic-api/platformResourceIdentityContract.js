import { createHash } from "node:crypto";

export const IDENTITY_SCOPES = Object.freeze([
  "global",
  "provider_native",
  "tenant",
  "workspace",
  "content_addressed",
  "ephemeral",
]);

export const IDENTITY_STATUSES = Object.freeze([
  "EXACT",
  "PROBABLE",
  "NONE",
  "CONFLICT",
  "AMBIGUOUS",
]);

export const RELATIONSHIP_TYPES = Object.freeze([
  "owns",
  "operates",
  "manages",
  "represents",
  "licenses",
  "contains",
  "member_of",
  "delegates",
  "binds",
  "references",
]);

const HARD_IDENTIFIER_TYPES = new Set([
  "provider_native_id",
  "verified_domain",
  "verified_registration_id",
  "verified_legal_id",
  "verified_dns_token",
]);

const PROBABLE_IDENTIFIER_TYPES = new Set([
  "brand_name",
  "domain_candidate",
  "provider_account_label",
  "external_alias",
]);

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function normalizedText(value, max = 2048) {
  return text(value, max).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function hash(parts) {
  return createHash("sha256").update(parts.map((part) => text(part)).join("|")).digest("hex");
}

export function normalizeIdentityValue(identifierType, value) {
  const type = normalizedText(identifierType, 64);
  let normalized = normalizedText(value, 2048);
  if (type.includes("domain") || type.includes("site") || /^https?:\/\//.test(normalized)) {
    normalized = normalized.replace(/^https?:\/\//, "").split("/")[0].replace(/\.+$/, "");
  }
  if (type.includes("registration") || type.includes("provider") || type.includes("legal")) {
    normalized = normalized.replace(/[\s\-_.:/]+/g, "");
  }
  return normalized;
}

export function canonicalResourceIdentity({ resourceType, identityScope, canonicalValue, providerFamily = "" } = {}) {
  const type = normalizedText(resourceType, 64);
  const scope = normalizedText(identityScope, 64);
  const value = normalizeIdentityValue(type, canonicalValue);
  const provider = normalizedText(providerFamily, 128);
  if (!type || !IDENTITY_SCOPES.includes(scope) || !value) {
    throw new TypeError("resourceType, supported identityScope, and canonicalValue are required");
  }
  if (scope === "global" && provider) {
    throw new TypeError("global identity cannot be provider-qualified");
  }
  const namespace = provider ? `${type}|${provider}|${value}` : `${type}|${value}`;
  return Object.freeze({
    resource_type: type,
    identity_scope: scope,
    provider_family: provider || null,
    canonical_value: value,
    canonical_id: `${type}_${hash([scope, namespace]).slice(0, 32)}`,
  });
}

export function validateIdentityDescriptor(descriptor = {}) {
  const errors = [];
  const resourceType = normalizedText(descriptor.resource_type, 64);
  const identityScope = normalizedText(descriptor.identity_scope, 64);
  const canonicalId = text(descriptor.canonical_id, 128);
  if (!resourceType) errors.push("resource_type_required");
  if (!IDENTITY_SCOPES.includes(identityScope)) errors.push("identity_scope_invalid");
  if (!canonicalId) errors.push("canonical_id_required");
  if (descriptor.tenant_id && identityScope === "global") errors.push("global_identity_must_not_carry_tenant_scope");
  if (descriptor.authority_implied === true) errors.push("identity_must_not_imply_authority");
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0
      ? Object.freeze({
          resource_type: resourceType,
          identity_scope: identityScope,
          canonical_id: canonicalId,
          revision: Number.isInteger(descriptor.revision) && descriptor.revision > 0 ? descriptor.revision : 1,
          status: text(descriptor.status, 32).toLowerCase() || "active",
          authority_implied: false,
        })
      : null,
  });
}

function normalizeIdentifier(identifier = {}) {
  const type = normalizedText(identifier.type, 64);
  const value = normalizeIdentityValue(type, identifier.value);
  const verification = normalizedText(identifier.verification_status || identifier.verification, 32) || "unverified";
  return {
    type,
    value,
    verification_status: verification,
    is_exclusive: identifier.is_exclusive === true,
    evidence_fresh: identifier.evidence_fresh !== false,
  };
}

function identifierStrength(identifier) {
  if (HARD_IDENTIFIER_TYPES.has(identifier.type) && identifier.verification_status === "verified" && identifier.evidence_fresh) return "hard";
  if (PROBABLE_IDENTIFIER_TYPES.has(identifier.type) || identifier.verification_status === "probable") return "probable";
  return "weak";
}

function candidateSummary(candidate, matched = []) {
  return Object.freeze({
    brand_id: text(candidate.brand_id, 128),
    matched_identifier_types: [...new Set(matched.map((item) => item.type))].sort(),
    evidence_ready: matched.some((item) => identifierStrength(item) === "hard"),
  });
}

export function resolveBrandIdentity({ identifiers = [], candidates = [] } = {}) {
  const requested = identifiers.map(normalizeIdentifier).filter((item) => item.type && item.value);
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      brand_id: text(candidate.brand_id, 128),
      identifiers: (Array.isArray(candidate.identifiers) ? candidate.identifiers : [])
        .map(normalizeIdentifier)
        .filter((item) => item.type && item.value),
    }))
    .filter((candidate) => candidate.brand_id);

  if (requested.length === 0 || normalizedCandidates.length === 0) {
    return Object.freeze({ status: "NONE", brand_id: null, candidates: [], reasons: [requested.length === 0 ? "identifier_required" : "no_candidate"] });
  }

  const matchedCandidates = normalizedCandidates.map((candidate) => {
    const matched = candidate.identifiers.filter((candidateIdentifier) =>
      requested.some((requestedIdentifier) =>
        requestedIdentifier.type === candidateIdentifier.type && requestedIdentifier.value === candidateIdentifier.value
      )
    );
    return { candidate, matched };
  }).filter(({ matched }) => matched.length > 0);

  if (matchedCandidates.length === 0) {
    return Object.freeze({ status: "NONE", brand_id: null, candidates: [], reasons: ["no_identifier_match"] });
  }

  const hardMatches = matchedCandidates.filter(({ matched }) => matched.some((item) => identifierStrength(item) === "hard"));
  const summaries = matchedCandidates.map(({ candidate, matched }) => candidateSummary(candidate, matched));

  if (hardMatches.length > 1) {
    return Object.freeze({ status: "CONFLICT", brand_id: null, candidates: summaries, reasons: ["multiple_hard_identifier_matches"] });
  }
  if (hardMatches.length === 1) {
    const selected = hardMatches[0];
    return Object.freeze({
      status: "EXACT",
      brand_id: selected.candidate.brand_id,
      candidates: [candidateSummary(selected.candidate, selected.matched)],
      reasons: ["one_unique_fresh_verified_identifier"],
    });
  }
  if (matchedCandidates.length > 1) {
    return Object.freeze({ status: "AMBIGUOUS", brand_id: null, candidates: summaries, reasons: ["multiple_non_hard_matches"] });
  }
  return Object.freeze({ status: "PROBABLE", brand_id: matchedCandidates[0].candidate.brand_id, candidates: summaries, reasons: ["only_non_hard_match"] });
}

export function validateResourceRelationship(relationship = {}) {
  const errors = [];
  const type = normalizedText(relationship.relationship_type, 64);
  const fromId = text(relationship.from_resource_id, 128);
  const toId = text(relationship.to_resource_id, 128);
  if (!RELATIONSHIP_TYPES.includes(type)) errors.push("relationship_type_invalid");
  if (!fromId || !toId) errors.push("relationship_endpoint_required");
  if (fromId && toId && fromId === toId && type !== "references") errors.push("self_relationship_not_allowed");
  if (relationship.authority_implied === true) errors.push("relationship_must_not_imply_authority");
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0
      ? Object.freeze({
          relationship_type: type,
          from_resource_id: fromId,
          to_resource_id: toId,
          tenant_id: text(relationship.tenant_id, 64) || null,
          revision: Number.isInteger(relationship.revision) && relationship.revision > 0 ? relationship.revision : 1,
          authority_implied: false,
        })
      : null,
  });
}

export const _testingPlatformResourceIdentity = Object.freeze({
  HARD_IDENTIFIER_TYPES,
  PROBABLE_IDENTIFIER_TYPES,
  normalizeIdentifier,
  identifierStrength,
});
