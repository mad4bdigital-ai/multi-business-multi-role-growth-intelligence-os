import { stableOperationHash } from "./operationRegistryContracts.js";

export const DEFAULT_OPERATION_BINDING_FALLBACK_LIMIT = 25;
const MAX_OPERATION_BINDING_FALLBACK_LIMIT = 100;
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;

export class OperationBindingFallbackError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationBindingFallbackError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationBindingFallbackError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_binding_fallback_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_binding_fallback_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function boundedInteger(value, field, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    fail("operation_binding_fallback_invalid_integer", `${field} must be between ${min} and ${max}.`, 400, { field });
  }
  return normalized;
}

function finiteNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) fail("operation_binding_fallback_invalid_number", `${field} must be finite.`, 400, { field });
  return normalized;
}

function reasonCodes(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || value.length > 100) {
    fail("operation_binding_fallback_reason_codes_invalid", `${field} must contain at most 100 reason codes.`, 400, { field });
  }
  const normalized = [...new Set(value.map((reason, index) => requiredString(reason, `${field}[${index}]`, { max: 128, pattern: SAFE_KEY_PATTERN })))].sort();
  if (required && normalized.length === 0) {
    fail("operation_binding_fallback_reason_codes_required", `${field} must contain at least one reason code.`, 400, { field });
  }
  return normalized;
}

function normalizeCandidate(input, index) {
  const field = `candidates[${index}]`;
  const root = requiredObject(input, field);
  const allowed = new Set(["binding_id", "binding_key", "eligible", "rank", "score", "exclusion_reasons"]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("operation_binding_fallback_unknown_field", `${field} contains unsupported fields.`, 400, { fields: unknown.sort() });
  }
  if (typeof root.eligible !== "boolean") {
    fail("operation_binding_fallback_eligible_invalid", `${field}.eligible must be boolean.`, 400, { field: `${field}.eligible` });
  }
  const candidate = {
    binding_id: requiredString(root.binding_id, `${field}.binding_id`, { max: 64 }),
    binding_key: requiredString(root.binding_key, `${field}.binding_key`, { pattern: SAFE_KEY_PATTERN }),
    eligible: root.eligible,
    rank: null,
    score: null,
    exclusion_reasons: [],
  };
  if (candidate.eligible) {
    if (!Array.isArray(root.rank) || root.rank.length === 0 || root.rank.length > 16) {
      fail("operation_binding_fallback_rank_invalid", `${field}.rank must contain between 1 and 16 values.`, 400, { field: `${field}.rank` });
    }
    candidate.rank = root.rank.map((value, rankIndex) => finiteNumber(value, `${field}.rank[${rankIndex}]`));
    candidate.score = finiteNumber(root.score, `${field}.score`);
    candidate.exclusion_reasons = reasonCodes(root.exclusion_reasons || [], `${field}.exclusion_reasons`);
    if (candidate.exclusion_reasons.length) {
      fail("operation_binding_fallback_eligible_has_exclusions", `${field} cannot be eligible and excluded.`, 409, { binding_id: candidate.binding_id });
    }
  } else {
    if (root.rank !== null && root.rank !== undefined) {
      fail("operation_binding_fallback_ineligible_rank_forbidden", `${field}.rank must be null for an ineligible candidate.`, 400, { field: `${field}.rank` });
    }
    if (root.score !== null && root.score !== undefined) {
      fail("operation_binding_fallback_ineligible_score_forbidden", `${field}.score must be null for an ineligible candidate.`, 400, { field: `${field}.score` });
    }
    candidate.exclusion_reasons = reasonCodes(root.exclusion_reasons || [], `${field}.exclusion_reasons`, { required: true });
  }
  return candidate;
}

export function compareOperationBindingRank(left, right) {
  if (left.rank.length !== right.rank.length) {
    fail("operation_binding_fallback_rank_shape_mismatch", "Eligible candidate rank vectors must have equal length.", 409, {
      left_binding_id: left.binding_id,
      right_binding_id: right.binding_id,
    });
  }
  for (let index = 0; index < left.rank.length; index += 1) {
    const delta = right.rank[index] - left.rank[index];
    if (delta !== 0) return delta;
  }
  return left.binding_key.localeCompare(right.binding_key);
}

export function sameOperationBindingRank(left, right) {
  return left.rank.length === right.rank.length && left.rank.every((value, index) => value === right.rank[index]);
}

function typedExclusion(candidate, exclusionType, reasonCodesValue) {
  return {
    binding_id: candidate.binding_id,
    binding_key: candidate.binding_key,
    exclusion_type: exclusionType,
    reason_codes: [...reasonCodesValue].sort(),
  };
}

export function buildOperationBindingFallbackPlan({
  candidates = [],
  max_fallbacks = DEFAULT_OPERATION_BINDING_FALLBACK_LIMIT,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 1000) {
    fail("operation_binding_fallback_candidates_invalid", "candidates must contain between 1 and 1000 entries.");
  }
  const fallbackLimit = boundedInteger(max_fallbacks, "max_fallbacks", 0, MAX_OPERATION_BINDING_FALLBACK_LIMIT);
  const normalized = candidates.map(normalizeCandidate);
  if (new Set(normalized.map((candidate) => candidate.binding_id)).size !== normalized.length) {
    fail("operation_binding_fallback_duplicate_id", "candidate binding IDs must be unique.");
  }
  if (new Set(normalized.map((candidate) => candidate.binding_key)).size !== normalized.length) {
    fail("operation_binding_fallback_duplicate_key", "candidate binding keys must be unique.");
  }

  const orderedEligible = normalized.filter((candidate) => candidate.eligible).sort(compareOperationBindingRank);
  const hardExcluded = normalized.filter((candidate) => !candidate.eligible);
  const primary = orderedEligible[0] || null;
  const fallbackCandidates = orderedEligible.slice(1, fallbackLimit + 1);
  const overflowCandidates = orderedEligible.slice(fallbackLimit + 1);
  const typedExclusions = [
    ...hardExcluded.map((candidate) => typedExclusion(candidate, "hard_constraint", candidate.exclusion_reasons)),
    ...overflowCandidates.map((candidate) => typedExclusion(candidate, "fallback_limit", ["fallback_limit_exceeded"])),
  ].sort((left, right) => left.binding_key.localeCompare(right.binding_key) || left.binding_id.localeCompare(right.binding_id));

  const reportCore = {
    schema_version: "operation-binding-fallback-plan-v1",
    max_fallbacks: fallbackLimit,
    primary_binding_id: primary?.binding_id || null,
    ordered_binding_ids: orderedEligible.map((candidate) => candidate.binding_id),
    fallback_binding_ids: fallbackCandidates.map((candidate) => candidate.binding_id),
    overflow_binding_ids: overflowCandidates.map((candidate) => candidate.binding_id),
    typed_exclusions: typedExclusions,
    summary: {
      candidate_count: normalized.length,
      eligible_count: orderedEligible.length,
      hard_excluded_count: hardExcluded.length,
      fallback_count: fallbackCandidates.length,
      overflow_count: overflowCandidates.length,
      fallback_truncated: overflowCandidates.length > 0,
      fail_closed: true,
    },
    primary_selected_by_plan: false,
    selection_authorized: false,
    fallback_executed: false,
    dispatch_authorized: false,
    authority_created: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false,
  };
  return {
    ok: true,
    report_type: "operation_binding_fallback_plan",
    ...reportCore,
    report_hash: stableOperationHash(reportCore),
  };
}
