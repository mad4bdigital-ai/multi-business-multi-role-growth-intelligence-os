import crypto from "node:crypto";

import { compileAuthorityPathInventory } from "./authorityPathInventoryCompiler.js";

export const AUTHORITY_EVIDENCE_SOURCE_FAMILIES = Object.freeze([
  "system_tool_registry",
  "admin_endpoint_catalog",
  "direct_http_routes",
  "runtime_action_registry",
  "descriptor_catalog",
  "provider_binding_catalog",
  "local_device_catalog",
  "compatibility_alias_registry",
]);

export const AUTHORITY_EVIDENCE_SOURCE_LIMITS = Object.freeze({
  maxSources: 128,
  maxRecordsPerSource: 8192,
  maxEvidenceRefsPerSource: 64,
});

const LIMIT_KEYS = Object.freeze(Object.keys(AUTHORITY_EVIDENCE_SOURCE_LIMITS));
const SOURCE_FAMILY_SET = new Set(AUTHORITY_EVIDENCE_SOURCE_FAMILIES);
const REQUIRED_SOURCE_FAMILIES = Object.freeze([...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort());
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityEvidenceSourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityEvidenceSourceError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSort(value[key]);
    return result;
  }, {});
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableSort(value))).digest("hex");
}

function assertNoSensitiveValues(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityEvidenceSourceError(
        "authority_evidence_secret_value_forbidden",
        "Authority evidence input contains a forbidden sensitive value.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_token",
      `${field} must be a stable bounded token.`,
      { field },
    );
  }
  return normalized;
}

function timestamp(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_timestamp",
      `${field} must be a valid timestamp.`,
      { field },
    );
  }
  return parsed.toISOString();
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_count",
      `${field} must be a non-negative safe integer.`,
      { field, value },
    );
  }
  return number;
}

function boolean(value, field) {
  if (typeof value !== "boolean") {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_boolean",
      `${field} must be boolean.`,
      { field },
    );
  }
  return value;
}

function resolveLimits(limits = AUTHORITY_EVIDENCE_SOURCE_LIMITS) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_limits",
      "Authority evidence limits must be an object.",
    );
  }
  const unknownKeys = Object.keys(limits).filter((key) => !LIMIT_KEYS.includes(key)).sort();
  if (unknownKeys.length) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_limits",
      "Authority evidence limits contain unknown keys.",
      { unknown_keys: unknownKeys },
    );
  }
  const resolved = {};
  for (const key of LIMIT_KEYS) {
    const value = Number(limits[key] ?? AUTHORITY_EVIDENCE_SOURCE_LIMITS[key]);
    const minimum = key === "maxSources" ? AUTHORITY_EVIDENCE_SOURCE_FAMILIES.length : 1;
    const maximum = AUTHORITY_EVIDENCE_SOURCE_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new AuthorityEvidenceSourceError(
        "authority_evidence_invalid_limit",
        "Authority evidence limits must stay within fixed platform bounds.",
        { key, value, minimum, maximum },
      );
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved);
}

function stringList(value, field, maxItems) {
  if (!Array.isArray(value)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_list",
      `${field} must be an array.`,
      { field },
    );
  }
  if (value.length > maxItems) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_limit_exceeded",
      `${field} exceeds its configured bound.`,
      { field, max_items: maxItems, observed: value.length },
    );
  }
  return [...new Set(value.map((item, index) => token(item, `${field}[${index}]`)))].sort();
}

function requireCompleteFamilyContract(expectedFamilies) {
  const missing = REQUIRED_SOURCE_FAMILIES.filter((family) => !expectedFamilies.includes(family));
  const extra = expectedFamilies.filter((family) => !SOURCE_FAMILY_SET.has(family));
  if (missing.length || extra.length || expectedFamilies.length !== REQUIRED_SOURCE_FAMILIES.length) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_incomplete_family_contract",
      "The v1 authority evidence contract requires all registered source families.",
      { missing_source_families: missing, extra_source_families: extra },
    );
  }
  return REQUIRED_SOURCE_FAMILIES;
}

function normalizeSafety(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_safety",
      `${field} must be an object.`,
      { field },
    );
  }
  const safety = {
    read_only: boolean(value.read_only, `${field}.read_only`),
    provider_calls: boolean(value.provider_calls, `${field}.provider_calls`),
    credential_payload_read: boolean(value.credential_payload_read, `${field}.credential_payload_read`),
    external_writes: boolean(value.external_writes, `${field}.external_writes`),
    secrets_included: boolean(value.secrets_included, `${field}.secrets_included`),
  };
  if (!safety.read_only || safety.provider_calls || safety.credential_payload_read || safety.external_writes || safety.secrets_included) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_unsafe_source",
      "Authority evidence sources must be read-only and no-effect.",
      { field },
    );
  }
  return safety;
}

function normalizePagination(value, recordCount, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_pagination",
      `${field} must be an object.`,
      { field },
    );
  }
  const expectedCount = nonNegativeInteger(value.expected_count, `${field}.expected_count`);
  const observedCount = nonNegativeInteger(value.observed_count, `${field}.observed_count`);
  const pageCount = nonNegativeInteger(value.page_count ?? 1, `${field}.page_count`);
  const complete = boolean(value.complete, `${field}.complete`);
  const nextCursor = value.next_cursor === null || value.next_cursor === undefined || value.next_cursor === ""
    ? null
    : token(value.next_cursor, `${field}.next_cursor`);
  return {
    expected_count: expectedCount,
    observed_count: observedCount,
    record_count: recordCount,
    page_count: pageCount,
    complete,
    next_cursor: nextCursor,
    consistent: observedCount === recordCount
      && expectedCount === observedCount
      && complete
      && nextCursor === null,
  };
}

function normalizePathRecord(record, sourceFamily, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_record",
      "Each authority evidence record must be an object.",
      { source_family: sourceFamily, index },
    );
  }
  assertNoSensitiveValues(record, `${sourceFamily}.records[${index}]`);
  return {
    ...record,
    source_registry: record.source_registry || sourceFamily,
    credential_payload_read: false,
    secrets_included: false,
  };
}

function normalizeSource(source, index, limits) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_source",
      "Each authority evidence source must be an object.",
      { index },
    );
  }
  const sourceFamily = token(source.source_family, `sources[${index}].source_family`);
  if (!SOURCE_FAMILY_SET.has(sourceFamily)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_unknown_source_family",
      "Authority evidence source family is not registered.",
      { source_family: sourceFamily },
    );
  }
  if (!Array.isArray(source.records)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_records",
      "Each authority evidence source must provide a records array.",
      { source_family: sourceFamily },
    );
  }
  if (source.records.length > limits.maxRecordsPerSource) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_limit_exceeded",
      "Authority evidence source record count exceeds its bound.",
      { source_family: sourceFamily, max_records: limits.maxRecordsPerSource, observed: source.records.length },
    );
  }

  const records = source.records.map((record, recordIndex) => normalizePathRecord(record, sourceFamily, recordIndex));
  const pagination = normalizePagination(source.pagination, records.length, `sources[${index}].pagination`);
  const safety = normalizeSafety(source.safety, `sources[${index}].safety`);
  const evidenceRefs = stringList(
    source.evidence_refs ?? [],
    `sources[${index}].evidence_refs`,
    limits.maxEvidenceRefsPerSource,
  );
  const declaredContentHash = String(source.content_sha256 ?? "").trim().toLowerCase();
  if (declaredContentHash && !HASH_PATTERN.test(declaredContentHash)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_hash",
      "content_sha256 must be a lowercase SHA-256 digest.",
      { source_family: sourceFamily },
    );
  }
  const computedContentHash = hash(records);
  const contentHashMatches = !declaredContentHash || declaredContentHash === computedContentHash;

  return {
    source_family: sourceFamily,
    source_key: token(source.source_key, `sources[${index}].source_key`),
    source_identity: token(source.source_identity, `sources[${index}].source_identity`),
    observed_at: timestamp(source.observed_at, `sources[${index}].observed_at`),
    pagination,
    evidence_refs: evidenceRefs,
    content_sha256: computedContentHash,
    declared_content_sha256: declaredContentHash || null,
    content_hash_matches: contentHashMatches,
    complete: pagination.consistent && contentHashMatches && evidenceRefs.length > 0,
    records,
    safety,
  };
}

export function buildAuthorityEvidenceSourceBundle({
  sources,
  expected_source_families: expectedSourceFamilies = AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  limits = AUTHORITY_EVIDENCE_SOURCE_LIMITS,
} = {}) {
  const resolvedLimits = resolveLimits(limits);
  if (!Array.isArray(sources)) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_invalid_sources",
      "sources must be an array.",
    );
  }
  if (sources.length > resolvedLimits.maxSources) {
    throw new AuthorityEvidenceSourceError(
      "authority_evidence_limit_exceeded",
      "Authority evidence source count exceeds its bound.",
      { max_sources: resolvedLimits.maxSources, observed: sources.length },
    );
  }
  assertNoSensitiveValues(sources, "sources");
  const expectedFamilies = requireCompleteFamilyContract(stringList(
    expectedSourceFamilies,
    "expected_source_families",
    AUTHORITY_EVIDENCE_SOURCE_FAMILIES.length,
  ));

  const normalizedSources = sources.map((source, index) => normalizeSource(source, index, resolvedLimits));
  const sourceKeys = new Set();
  const sourceFamilies = new Set();
  for (const source of normalizedSources) {
    if (sourceKeys.has(source.source_key)) {
      throw new AuthorityEvidenceSourceError(
        "authority_evidence_duplicate_source_key",
        "Authority evidence source keys must be unique.",
        { source_key: source.source_key },
      );
    }
    if (sourceFamilies.has(source.source_family)) {
      throw new AuthorityEvidenceSourceError(
        "authority_evidence_duplicate_source_family",
        "Each registered source family must produce one reconciled snapshot.",
        { source_family: source.source_family },
      );
    }
    sourceKeys.add(source.source_key);
    sourceFamilies.add(source.source_family);
  }

  const missingFamilies = expectedFamilies.filter((family) => !sourceFamilies.has(family));
  const incompleteFamilies = normalizedSources
    .filter((source) => !source.complete)
    .map((source) => source.source_family)
    .sort();
  const inventory = compileAuthorityPathInventory({
    source_snapshots: normalizedSources.map((source) => ({
      source_key: source.source_key,
      source_identity: source.source_identity,
      observed_at: source.observed_at,
      complete: source.complete,
      paths: source.records,
      secrets_included: false,
    })),
    expected_source_keys: normalizedSources.map((source) => source.source_key),
  });

  const gaps = [
    ...missingFamilies.map((sourceFamily) => ({ code: "missing_source_family", source_family: sourceFamily, blocking: true })),
    ...incompleteFamilies.map((sourceFamily) => ({ code: "incomplete_source_family", source_family: sourceFamily, blocking: true })),
    ...inventory.gaps,
  ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const blockingGapCount = gaps.filter((gap) => gap.blocking).length;
  const bundle = {
    contract: "mad4b.ueacp.authority-evidence-source-bundle.v1",
    status: blockingGapCount === 0 ? "ready_for_ownership_review" : "incomplete",
    limits: resolvedLimits,
    expected_source_families: expectedFamilies,
    source_family_count: normalizedSources.length,
    sources: normalizedSources.sort((left, right) => left.source_family.localeCompare(right.source_family)),
    inventory,
    gaps,
    blocking_gap_count: blockingGapCount,
    closure_state: {
      t001_complete: false,
      source_evidence_ready_for_human_review: blockingGapCount === 0,
      reason: blockingGapCount === 0
        ? "All registered source families are complete and the canonical inventory has no blocking machine gaps; human unregistered-path review is still required."
        : "Source-family, pagination, content-hash, or authority-path gaps remain.",
    },
    read_only: true,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  bundle.bundle_sha256 = hash(bundle);
  return deepFreeze(bundle);
}

export const _testingAuthorityEvidenceSourceAdapters = {
  hash,
  normalizePagination,
  normalizeSource,
  requireCompleteFamilyContract,
  resolveLimits,
  assertNoSensitiveValues,
};
