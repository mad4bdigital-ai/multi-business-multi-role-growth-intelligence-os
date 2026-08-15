import { createHash, randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";
import {
  resolveBrandIdentity as resolveInMemoryBrandIdentity,
  validateIdentityDescriptor,
  validateResourceRelationship,
} from "./platformResourceIdentityContract.js";

const PERSISTENT_HARD_IDENTIFIER_TYPES = new Set([
  "verified_domain",
  "verified_domain_control",
  "provider_native_id",
  "provider_account_id",
  "verified_registration_id",
  "legal_registration_number",
  "verified_legal_id",
  "trademark_identifier",
  "meta_page_id",
  "shopify_store_id",
  "google_business_entity_id",
  "verified_dns_token",
]);

const PERSISTENT_MEDIUM_IDENTIFIER_TYPES = new Set([
  "canonical_website",
  "verified_social_account",
  "corporate_email_domain",
  "redirected_official_domain",
]);

const PERSISTENT_WEAK_IDENTIFIER_TYPES = new Set([
  "brand_name",
  "display_name",
  "normalized_name",
  "domain_candidate",
  "logo_similarity",
  "industry",
  "address",
  "phone",
  "unverified_social_handle",
  "external_alias",
]);

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
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

  const resolution = resolveInMemoryBrandIdentity({
    identifiers,
    candidates: visibleCandidates,
  });

  // Compatibility helper: candidate tenant metadata is stripped before returning.
  // Persistent global identity resolution below does not scope identity by tenant.
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

function normalizeHost(value) {
  let raw = text(value, 2048);
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw)) raw = `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  const ascii = domainToASCII(parsed.hostname.replace(/\.$/u, "").toLowerCase());
  if (!ascii) return "";
  return ascii.replace(/^www\./u, "");
}

export function normalizeBrandDomain(value) {
  return normalizeHost(value);
}

export function normalizeBrandUrl(value) {
  const raw = text(value, 2048);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = normalizeHost(parsed.hostname);
  if (!host) return "";
  const protocol = parsed.protocol === "http:" ? "http:" : "https:";
  const port = parsed.port && !((protocol === "https:" && parsed.port === "443") || (protocol === "http:" && parsed.port === "80"))
    ? `:${parsed.port}`
    : "";
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/u, "");
  return `${protocol}//${host}${port}${pathname}${parsed.search}`;
}

function persistentIdentifierClass(identifierType) {
  const type = text(identifierType, 64).toLowerCase();
  if (PERSISTENT_HARD_IDENTIFIER_TYPES.has(type)) return "hard";
  if (PERSISTENT_MEDIUM_IDENTIFIER_TYPES.has(type)) return "medium";
  return "weak";
}

function normalizePersistentIdentifierValue(identifierType, value) {
  const type = text(identifierType, 64).toLowerCase();
  if ([
    "verified_domain",
    "verified_domain_control",
    "domain_candidate",
    "corporate_email_domain",
    "redirected_official_domain",
  ].includes(type)) {
    return normalizeBrandDomain(value);
  }
  if (type === "canonical_website") return normalizeBrandUrl(value);
  if (["brand_name", "display_name", "normalized_name", "industry", "address"].includes(type)) {
    return text(value, 2048).replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  }
  return text(value, 2048).toLocaleLowerCase("en-US");
}

export function normalizePersistentBrandIdentifier(input = {}) {
  const identifierType = text(input.identifier_type || input.type, 64).toLowerCase();
  const providerFamily = text(input.provider_family, 64).toLowerCase();
  const normalizedValue = normalizePersistentIdentifierValue(identifierType, input.value ?? input.normalized_value);
  if (!identifierType || !normalizedValue) return null;
  return Object.freeze({
    identifier_type: identifierType,
    normalized_value: normalizedValue,
    normalized_value_hash: sha256(normalizedValue),
    provider_family: providerFamily,
    // Caller-supplied verification is deliberately ignored. Stored evidence determines strength.
    verification_status: "unverified",
    confidence_class: persistentIdentifierClass(identifierType),
    source: text(input.source, 64) || "brand_input",
    evidence_ref: null,
  });
}

export function normalizeBrandInputIdentifiers({ brandDomain = null, canonicalUrl = null, brandName = null, identifiers = [] } = {}) {
  const values = [];
  if (brandDomain) {
    values.push({ identifier_type: "verified_domain", value: brandDomain, source: "brand_domain_input" });
    values.push({ identifier_type: "domain_candidate", value: brandDomain, source: "brand_domain_input" });
  }
  if (canonicalUrl) values.push({ identifier_type: "canonical_website", value: canonicalUrl, source: "canonical_url_input" });
  if (brandName) values.push({ identifier_type: "brand_name", value: brandName, source: "brand_name_input" });
  if (Array.isArray(identifiers)) values.push(...identifiers);
  const unique = new Map();
  for (const value of values) {
    const normalized = normalizePersistentBrandIdentifier(value);
    if (!normalized) continue;
    const key = `${normalized.identifier_type}|${normalized.provider_family}|${normalized.normalized_value_hash}`;
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function currentBrand(row) {
  const status = text(row?.status, 32).toLowerCase();
  const identityStatus = text(row?.identity_status, 32).toLowerCase();
  return !["archived", "inactive", "disabled"].includes(status)
    && !["archived", "superseded"].includes(identityStatus);
}

function persistentResolution(status, details = {}) {
  const canonical = status === "EXACT" || status === "PROBABLE" ? text(details.brand_id, 64) || null : null;
  return Object.freeze({
    status,
    canonical_resource_id: canonical,
    brand_id: canonical,
    candidate_count: Number(details.candidate_count || 0),
    matched_identifier_types: [...new Set(details.matched_identifier_types || [])].sort(),
    matched_alias_types: [...new Set(details.matched_alias_types || [])].sort(),
    reason: details.reason || null,
    disclosure_policy: "canonical_identity_only_no_tenant_enumeration",
    authority_required: true,
    relationship_required: true,
    cross_tenant_details_included: false,
    secrets_included: false,
  });
}

async function readPersistentBrandsByIds(executor, brandIds, { lock = false } = {}) {
  const ids = [...new Set((brandIds || []).map((value) => text(value, 64)).filter(Boolean))];
  if (!ids.length) return [];
  const [rows] = await executor.query(
    `SELECT id, brand_id, brand_name, normalized_brand_name, target_key, status, identity_status, resource_revision, brand_core_ready
       FROM brands
      WHERE brand_id IN (${ids.map(() => "?").join(",")})
      LIMIT 101${lock ? " FOR UPDATE" : ""}`,
    ids
  );
  return Array.isArray(rows) ? rows : [];
}

export async function resolvePersistentBrandIdentity(executor, {
  brandId = null,
  aliases = [],
  identifiers = [],
  lock = false,
} = {}) {
  if (!executor || typeof executor.query !== "function") {
    throw Object.assign(new Error("Brand identity SQL executor is unavailable."), { code: "brand_identity_executor_unavailable", status: 500 });
  }

  const directBrandId = text(brandId, 64);
  if (directBrandId) {
    const rows = await readPersistentBrandsByIds(executor, [directBrandId], { lock });
    const active = rows.filter((row) => currentBrand(row) && text(row.brand_id, 64) === directBrandId);
    if (active.length === 1) return persistentResolution("EXACT", { brand_id: directBrandId, candidate_count: 1, reason: "canonical_brand_id" });
    if (active.length > 1) return persistentResolution("CONFLICT", { candidate_count: active.length, reason: "canonical_brand_id_non_unique" });
  }

  const candidateEvidence = new Map();
  const addCandidate = (candidateBrandId, evidence) => {
    const id = text(candidateBrandId, 64);
    if (!id) return;
    if (!candidateEvidence.has(id)) candidateEvidence.set(id, []);
    candidateEvidence.get(id).push(evidence);
  };

  const normalizedAliases = (Array.isArray(aliases) ? aliases : [])
    .map((item) => ({
      alias_type: text(item?.alias_type || item?.type, 64).toLowerCase(),
      alias_value: text(item?.alias_value ?? item?.value, 2048),
    }))
    .filter((item) => item.alias_type && item.alias_value)
    .map((item) => ({ ...item, alias_value_hash: sha256(item.alias_value) }));

  for (const alias of normalizedAliases) {
    const [rows] = await executor.query(
      `SELECT alias_type, alias_value_hash, brand_id, status
         FROM brand_identity_aliases
        WHERE alias_type=? AND alias_value_hash=? AND status='active'
        LIMIT 3${lock ? " FOR UPDATE" : ""}`,
      [alias.alias_type, alias.alias_value_hash]
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      addCandidate(row.brand_id, { kind: "alias", alias_type: alias.alias_type, strength: "hard", verified: true });
    }
  }

  const normalizedIdentifiers = (Array.isArray(identifiers) ? identifiers : [])
    .map((item) => normalizePersistentBrandIdentifier(item))
    .filter(Boolean);

  for (const identifier of normalizedIdentifiers) {
    const [rows] = await executor.query(
      `SELECT identifier_type, provider_family, normalized_value_hash, verification_status, confidence_class, brand_id, status
         FROM brand_identifiers
        WHERE identifier_type=?
          AND provider_family=?
          AND normalized_value_hash=?
          AND status='active'
          AND (valid_from IS NULL OR valid_from<=UTC_TIMESTAMP())
          AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP())
        LIMIT 20${lock ? " FOR UPDATE" : ""}`,
      [identifier.identifier_type, identifier.provider_family, identifier.normalized_value_hash]
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      addCandidate(row.brand_id, {
        kind: "identifier",
        identifier_type: identifier.identifier_type,
        strength: text(row.confidence_class, 16).toLowerCase() || persistentIdentifierClass(identifier.identifier_type),
        verified: text(row.verification_status, 32).toLowerCase() === "verified",
      });
    }
  }

  if (!candidateEvidence.size) return persistentResolution("NONE", { reason: "no_identity_candidate" });

  const brands = await readPersistentBrandsByIds(executor, [...candidateEvidence.keys()], { lock });
  const activeBrandIds = new Set(brands.filter(currentBrand).map((row) => text(row.brand_id, 64)).filter(Boolean));
  for (const id of [...candidateEvidence.keys()]) {
    if (!activeBrandIds.has(id)) candidateEvidence.delete(id);
  }
  if (!candidateEvidence.size) return persistentResolution("NONE", { reason: "no_active_identity_candidate" });

  const hardVerified = [];
  const probable = [];
  for (const [candidateBrandId, evidence] of candidateEvidence.entries()) {
    const hasAlias = evidence.some((item) => item.kind === "alias");
    const hasHardVerified = evidence.some((item) => item.kind === "identifier" && item.strength === "hard" && item.verified);
    if (hasAlias || hasHardVerified) hardVerified.push(candidateBrandId);
    else probable.push(candidateBrandId);
  }

  if (hardVerified.length > 1) {
    return persistentResolution("CONFLICT", {
      candidate_count: hardVerified.length,
      matched_identifier_types: [...candidateEvidence.values()].flat().filter((item) => item.kind === "identifier").map((item) => item.identifier_type),
      matched_alias_types: [...candidateEvidence.values()].flat().filter((item) => item.kind === "alias").map((item) => item.alias_type),
      reason: "conflicting_hard_identity",
    });
  }
  if (hardVerified.length === 1) {
    const matchedBrandId = hardVerified[0];
    const evidence = candidateEvidence.get(matchedBrandId) || [];
    return persistentResolution("EXACT", {
      brand_id: matchedBrandId,
      candidate_count: 1,
      matched_identifier_types: evidence.filter((item) => item.kind === "identifier").map((item) => item.identifier_type),
      matched_alias_types: evidence.filter((item) => item.kind === "alias").map((item) => item.alias_type),
      reason: "verified_hard_identity",
    });
  }
  if (probable.length === 1) {
    const evidence = candidateEvidence.get(probable[0]) || [];
    return persistentResolution("PROBABLE", {
      brand_id: probable[0],
      candidate_count: 1,
      matched_identifier_types: evidence.filter((item) => item.kind === "identifier").map((item) => item.identifier_type),
      reason: "non_authoritative_identity_candidate",
    });
  }
  return persistentResolution("AMBIGUOUS", {
    candidate_count: probable.length,
    matched_identifier_types: [...candidateEvidence.values()].flat().filter((item) => item.kind === "identifier").map((item) => item.identifier_type),
    reason: "multiple_non_authoritative_candidates",
  });
}

export function canonicalGlobalBrandTargetKey(brandId) {
  const id = text(brandId, 64);
  if (!id) return "";
  return `brand_${sha256(id).slice(0, 32)}`;
}

export function newGlobalBrandIdentity() {
  const brandId = randomUUID();
  return Object.freeze({ brand_id: brandId, target_key: canonicalGlobalBrandTargetKey(brandId), resource_revision: 1 });
}

export function publicPersistentBrandIdentityResolution(result = {}) {
  return Object.freeze({
    status: text(result.status, 32) || "NONE",
    canonical_resource_id: result.canonical_resource_id || null,
    brand_id: result.brand_id || null,
    candidate_count: Number(result.candidate_count || 0),
    matched_identifier_types: [...new Set(result.matched_identifier_types || [])],
    matched_alias_types: [...new Set(result.matched_alias_types || [])],
    reason: result.reason || null,
    disclosure_policy: "canonical_identity_only_no_tenant_enumeration",
    authority_required: true,
    relationship_required: true,
    cross_tenant_details_included: false,
    secrets_included: false,
  });
}

export const _testingBrandIdentityResolver = Object.freeze({
  tenantVisibleCandidate,
  PERSISTENT_HARD_IDENTIFIER_TYPES,
  PERSISTENT_MEDIUM_IDENTIFIER_TYPES,
  PERSISTENT_WEAK_IDENTIFIER_TYPES,
  persistentIdentifierClass,
  normalizePersistentIdentifierValue,
  currentBrand,
  sha256,
});
