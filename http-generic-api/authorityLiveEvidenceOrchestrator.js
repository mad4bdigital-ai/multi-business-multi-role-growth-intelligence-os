import crypto from "node:crypto";

import {
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  buildAuthorityEvidenceSourceBundle,
} from "./authorityEvidenceSourceAdapters.js";
import { collectAuthorityCatalogCensus } from "./authorityCatalogCensus.js";
import { assessAuthorityOwnershipReview } from "./authorityOwnershipReview.js";

export const AUTHORITY_LIVE_EVIDENCE_LIMITS = Object.freeze({
  maxAuthorizationLifetimeMs: 60 * 60 * 1000,
  maxObservationSpreadMs: 10 * 60 * 1000,
});

const AUTHORIZATION_CONTRACT = "mad4b.ueacp.authority-live-evidence-authorization.v1";
const PACKET_CONTRACT = "mad4b.ueacp.authority-live-evidence-packet.v1";
const REVIEW_PACKET_CONTRACT = "mad4b.ueacp.authority-live-evidence-review-packet.v1";
const OPERATION_MODE = "read_only_live_authority_evidence";
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityLiveEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityLiveEvidenceError";
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
      throw new AuthorityLiveEvidenceError(
        "authority_live_evidence_sensitive_value_forbidden",
        "Live evidence inputs and outputs must not contain secret-bearing values.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_token",
      `${field} must be a bounded canonical token.`,
      { field },
    );
  }
  return normalized;
}

function instant(value, field) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_timestamp",
      `${field} must be a valid timestamp.`,
      { field },
    );
  }
  return parsed.toISOString();
}

function exactBoolean(value, expected, field) {
  if (value !== expected) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_unsafe_authorization",
      `${field} must equal ${expected}.`,
      { field, expected, observed: value },
    );
  }
  return value;
}

function normalizeAuthorization(authorization, now) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_authorization",
      "operation_authorization must be an object.",
    );
  }
  assertNoSensitiveValues(authorization, "operation_authorization");
  if (authorization.contract !== AUTHORIZATION_CONTRACT) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_authorization_contract",
      "The governed live evidence authorization contract is required.",
    );
  }
  if (authorization.operation_mode !== OPERATION_MODE) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_operation_mode",
      "Only the read-only live authority evidence mode is accepted.",
    );
  }

  exactBoolean(authorization.approved, true, "operation_authorization.approved");
  exactBoolean(authorization.read_only, true, "operation_authorization.read_only");
  exactBoolean(authorization.applies_sql, false, "operation_authorization.applies_sql");
  exactBoolean(authorization.provider_calls, false, "operation_authorization.provider_calls");
  exactBoolean(authorization.credential_payload_read, false, "operation_authorization.credential_payload_read");
  exactBoolean(authorization.external_writes, false, "operation_authorization.external_writes");
  exactBoolean(authorization.secrets_included, false, "operation_authorization.secrets_included");

  const issuedAt = instant(authorization.issued_at, "operation_authorization.issued_at");
  const expiresAt = instant(authorization.expires_at, "operation_authorization.expires_at");
  const nowIso = instant(now, "now");
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(nowIso);
  if (expiresMs <= issuedMs || expiresMs - issuedMs > AUTHORITY_LIVE_EVIDENCE_LIMITS.maxAuthorizationLifetimeMs) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_authorization_window",
      "The authorization window must be positive and no longer than one hour.",
    );
  }
  if (nowMs < issuedMs || nowMs > expiresMs) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_authorization_inactive",
      "The live evidence authorization is not active for this operation cycle.",
    );
  }

  return deepFreeze({
    contract: AUTHORIZATION_CONTRACT,
    operation_mode: OPERATION_MODE,
    operation_ref: token(authorization.operation_ref, "operation_authorization.operation_ref"),
    environment: token(authorization.environment, "operation_authorization.environment"),
    target_schema: token(authorization.target_schema, "operation_authorization.target_schema"),
    issued_at: issuedAt,
    expires_at: expiresAt,
    approved: true,
    read_only: true,
    applies_sql: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  });
}

function normalizeCollectors(sourceCollectors) {
  if (!sourceCollectors || typeof sourceCollectors !== "object" || Array.isArray(sourceCollectors)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_collectors",
      "source_collectors must be an object keyed by registered source family.",
    );
  }
  const provided = Object.keys(sourceCollectors).sort();
  const required = [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort();
  const missing = required.filter((family) => !provided.includes(family));
  const extra = provided.filter((family) => !required.includes(family));
  if (missing.length || extra.length || provided.length !== required.length) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_incomplete_collectors",
      "Exactly one collector is required for every registered source family.",
      { missing_source_families: missing, extra_source_families: extra },
    );
  }
  for (const family of required) {
    if (typeof sourceCollectors[family] !== "function") {
      throw new AuthorityLiveEvidenceError(
        "authority_live_evidence_invalid_collector",
        "Every source collector must be a function.",
        { source_family: family },
      );
    }
  }
  return required;
}

function validateCatalog(catalog, authorization) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_catalog",
      "The catalog collector must return an authority catalog census object.",
    );
  }
  assertNoSensitiveValues(catalog, "catalog_census");
  if (catalog.ok !== true || catalog.read_only !== true || catalog.applies_sql !== false) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_unsafe_catalog",
      "The catalog census must be successful, read-only, and non-mutating.",
    );
  }
  if (
    catalog.provider_calls !== false
    || catalog.credential_payload_read !== false
    || catalog.external_writes !== false
    || catalog.secrets_included !== false
  ) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_unsafe_catalog",
      "The catalog census contains unsafe effect markers.",
    );
  }
  if (String(catalog.schema_name ?? "") !== authorization.target_schema) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_schema_mismatch",
      "The observed catalog schema does not match the authorized target schema.",
      { expected_schema: authorization.target_schema, observed_schema: catalog.schema_name ?? null },
    );
  }
  return catalog;
}

function verifyObservationWindow(authorization, sourceBundle, catalog) {
  const observed = [
    ...sourceBundle.sources.map((source) => ({ key: source.source_family, at: instant(source.observed_at, `source:${source.source_family}`) })),
    { key: "authority_catalog_census", at: instant(catalog.database_server?.observed_at, "catalog_census.database_server.observed_at") },
  ];
  const issuedMs = Date.parse(authorization.issued_at);
  const expiresMs = Date.parse(authorization.expires_at);
  const outsideWindow = observed.filter(({ at }) => {
    const value = Date.parse(at);
    return value < issuedMs || value > expiresMs;
  });
  if (outsideWindow.length) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_observation_outside_authorization",
      "All observations must occur inside the governed authorization window.",
      { observations: outsideWindow.map((item) => item.key).sort() },
    );
  }
  const times = observed.map(({ at }) => Date.parse(at));
  const earliestMs = Math.min(...times);
  const latestMs = Math.max(...times);
  const spreadMs = latestMs - earliestMs;
  if (spreadMs > AUTHORITY_LIVE_EVIDENCE_LIMITS.maxObservationSpreadMs) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_cycle_spread_exceeded",
      "Source and catalog observations must be captured within one bounded evidence cycle.",
      { max_spread_ms: AUTHORITY_LIVE_EVIDENCE_LIMITS.maxObservationSpreadMs, observed_spread_ms: spreadMs },
    );
  }
  return deepFreeze({
    earliest_observed_at: new Date(earliestMs).toISOString(),
    latest_observed_at: new Date(latestMs).toISOString(),
    observation_spread_ms: spreadMs,
    observation_count: observed.length,
  });
}

function verifyPacketHash(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet) || packet.contract !== PACKET_CONTRACT) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_packet",
      "A canonical live evidence packet is required.",
    );
  }
  const declared = String(packet.packet_sha256 ?? "").toLowerCase();
  if (!HASH_PATTERN.test(declared)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_packet_hash",
      "packet_sha256 must be a lowercase SHA-256 digest.",
    );
  }
  const { packet_sha256: _ignored, ...unsigned } = packet;
  const computed = hash(unsigned);
  if (computed !== declared) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_stale_packet_hash",
      "The live evidence packet has changed since its hash was computed.",
    );
  }
  return declared;
}

export async function collectGovernedAuthorityLiveEvidence({
  operation_authorization: operationAuthorization,
  source_collectors: sourceCollectors,
  catalog_collector: catalogCollector = collectAuthorityCatalogCensus,
  now = new Date(),
} = {}) {
  const authorization = normalizeAuthorization(operationAuthorization, now);
  const families = normalizeCollectors(sourceCollectors);
  if (typeof catalogCollector !== "function") {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_invalid_catalog_collector",
      "catalog_collector must be a function.",
    );
  }

  const context = deepFreeze({
    contract: "mad4b.ueacp.authority-live-evidence-collector-context.v1",
    operation_ref: authorization.operation_ref,
    environment: authorization.environment,
    target_schema: authorization.target_schema,
    authorization_issued_at: authorization.issued_at,
    authorization_expires_at: authorization.expires_at,
    read_only: true,
    applies_sql: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  });

  const sources = [];
  for (const family of families) {
    const source = await sourceCollectors[family](deepFreeze({ ...context, source_family: family }));
    assertNoSensitiveValues(source, `source:${family}`);
    if (source?.source_family !== family) {
      throw new AuthorityLiveEvidenceError(
        "authority_live_evidence_collector_family_mismatch",
        "A source collector may only return evidence for its assigned family.",
        { expected_source_family: family, observed_source_family: source?.source_family ?? null },
      );
    }
    sources.push(source);
  }

  const sourceBundle = buildAuthorityEvidenceSourceBundle({ sources });
  const catalog = validateCatalog(
    await catalogCollector({ schemaName: authorization.target_schema }),
    authorization,
  );
  const cycle = verifyObservationWindow(authorization, sourceBundle, catalog);
  const blockingIssues = [];
  if (sourceBundle.status !== "ready_for_ownership_review" || sourceBundle.blocking_gap_count !== 0) {
    blockingIssues.push("source_bundle_not_ready");
  }

  const unsignedPacket = {
    contract: PACKET_CONTRACT,
    status: blockingIssues.length === 0 ? "ready_for_human_ownership_review" : "blocked",
    operation: authorization,
    cycle,
    source_bundle: sourceBundle,
    catalog_census: catalog,
    bindings: {
      source_bundle_sha256: sourceBundle.bundle_sha256,
      inventory_sha256: sourceBundle.inventory.inventory_sha256,
      catalog_sha256: hash(catalog),
    },
    blocking_issues: blockingIssues,
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      live_evidence_ready_for_human_ownership_review: blockingIssues.length === 0,
      migration_design_input_ready: false,
      migration_apply_authorized: false,
    },
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  const packet = { ...unsignedPacket, packet_sha256: hash(unsignedPacket) };
  return deepFreeze(packet);
}

export function finalizeGovernedAuthorityLiveEvidence({
  live_evidence_packet: packet,
  review_entries: reviewEntries,
  reviewer_key: reviewerKey,
  reviewed_at: reviewedAt,
  readback_ref: readbackRef,
} = {}) {
  assertNoSensitiveValues({ packet, reviewEntries, reviewerKey, reviewedAt, readbackRef });
  const packetSha256 = verifyPacketHash(packet);
  if (packet.status !== "ready_for_human_ownership_review" || packet.blocking_issues.length !== 0) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_packet_not_ready",
      "The live evidence packet is not ready for ownership review.",
    );
  }
  const normalizedReviewedAt = instant(reviewedAt, "reviewed_at");
  if (Date.parse(normalizedReviewedAt) < Date.parse(packet.cycle.latest_observed_at)) {
    throw new AuthorityLiveEvidenceError(
      "authority_live_evidence_review_precedes_observation",
      "The ownership review cannot precede the latest live observation.",
    );
  }

  const ownershipReview = assessAuthorityOwnershipReview({
    catalog_census: packet.catalog_census,
    source_bundle: packet.source_bundle,
    review_entries: reviewEntries,
    review_metadata: {
      reviewer_key: token(reviewerKey, "reviewer_key"),
      reviewed_at: normalizedReviewedAt,
      evidence_context: {
        environment: packet.operation.environment,
        operation_ref: packet.operation.operation_ref,
        readback_ref: token(readbackRef, "readback_ref"),
        live_observation: true,
        same_cycle_readback: true,
      },
    },
  });

  const ready = ownershipReview.status === "ready_for_human_task_closure_review"
    && ownershipReview.closure_state.t001_ready_for_human_closure === true
    && ownershipReview.closure_state.t002_ready_for_human_closure === true;
  const unsignedReviewPacket = {
    contract: REVIEW_PACKET_CONTRACT,
    status: ready ? "ready_for_human_t001_t002_closeout" : "blocked",
    live_evidence_packet_sha256: packetSha256,
    ownership_review: ownershipReview,
    bindings: {
      source_bundle_sha256: packet.bindings.source_bundle_sha256,
      inventory_sha256: packet.bindings.inventory_sha256,
      catalog_sha256: packet.bindings.catalog_sha256,
      ownership_review_sha256: ownershipReview.review_sha256,
    },
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      t001_ready_for_human_closure: ready,
      t002_ready_for_human_closure: ready,
      migration_design_input_ready_after_explicit_closeout: ready,
      migration_apply_authorized: false,
      tasks_auto_closed: false,
    },
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  const reviewPacket = { ...unsignedReviewPacket, review_packet_sha256: hash(unsignedReviewPacket) };
  return deepFreeze(reviewPacket);
}

export const _testingAuthorityLiveEvidenceOrchestrator = {
  hash,
  normalizeAuthorization,
  normalizeCollectors,
  verifyObservationWindow,
  verifyPacketHash,
  assertNoSensitiveValues,
};
