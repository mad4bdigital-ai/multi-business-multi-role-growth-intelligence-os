import { stableOperationHash } from "./operationRegistryContracts.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const DISPOSITIONS = new Set(["selected", "fallback", "overflow", "excluded"]);
const RANK_LABELS = Object.freeze([
  "scope_specificity",
  "provider_match",
  "capability_match",
  "priority",
  "inverse_fallback_rank",
  "score",
]);

export class OperationBindingResolverExplainError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationBindingResolverExplainError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationBindingResolverExplainError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_binding_explain_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_binding_explain_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, options);
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_binding_explain_invalid_hash", `${field} must be SHA-256.`, 400, { field });
  return normalized;
}

function finiteNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) fail("operation_binding_explain_invalid_number", `${field} must be finite.`, 400, { field });
  return normalized;
}

function reasonCodes(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.length > 100) {
    fail("operation_binding_explain_reason_codes_invalid", `${field} must contain at most 100 reason codes.`, 400, { field });
  }
  const normalized = [...new Set(value.map((entry, index) => requiredString(entry, `${field}[${index}]`, { max: 128, pattern: SAFE_KEY_PATTERN })))].sort();
  if (!allowEmpty && normalized.length === 0) {
    fail("operation_binding_explain_reason_codes_required", `${field} must contain at least one reason code.`, 400, { field });
  }
  return normalized;
}

function idList(value, field, { max = 1000 } = {}) {
  if (!Array.isArray(value) || value.length > max) {
    fail("operation_binding_explain_id_list_invalid", `${field} must contain at most ${max} IDs.`, 400, { field });
  }
  const normalized = value.map((entry, index) => requiredString(entry, `${field}[${index}]`, { max: 64 }));
  if (new Set(normalized).size !== normalized.length) {
    fail("operation_binding_explain_duplicate_id", `${field} contains duplicate IDs.`, 409, { field });
  }
  return normalized;
}

function normalizeRank(value, field, eligible) {
  if (!eligible) {
    if (value !== null && value !== undefined) {
      fail("operation_binding_explain_ineligible_rank_forbidden", `${field} must be null for an excluded candidate.`, 400, { field });
    }
    return null;
  }
  if (!Array.isArray(value) || value.length !== RANK_LABELS.length) {
    fail("operation_binding_explain_rank_invalid", `${field} must contain ${RANK_LABELS.length} values.`, 400, { field });
  }
  return value.map((entry, index) => finiteNumber(entry, `${field}[${index}]`));
}

function rankDimensions(rank) {
  if (!rank) return null;
  return Object.fromEntries(RANK_LABELS.map((label, index) => [label, rank[index]]));
}

function normalizeCandidateEvidence(input, index) {
  const field = `candidate_evidence[${index}]`;
  const root = requiredObject(input, field);
  const allowed = new Set([
    "binding_id", "binding_key", "binding_scope_type", "provider_family", "eligible", "selected",
    "exclusion_reasons", "rank", "score", "revision_hash",
  ]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("operation_binding_explain_unknown_candidate_field", `${field} contains unsupported fields.`, 400, { fields: unknown.sort() });
  }
  if (typeof root.eligible !== "boolean" || typeof root.selected !== "boolean") {
    fail("operation_binding_explain_candidate_flags_invalid", `${field} eligible and selected must be boolean.`, 400, { field });
  }
  const rank = normalizeRank(root.rank, `${field}.rank`, root.eligible);
  const score = root.eligible ? finiteNumber(root.score, `${field}.score`) : null;
  if (!root.eligible && root.score !== null && root.score !== undefined) {
    fail("operation_binding_explain_ineligible_score_forbidden", `${field}.score must be null for an excluded candidate.`, 400, { field: `${field}.score` });
  }
  const exclusions = reasonCodes(root.exclusion_reasons || [], `${field}.exclusion_reasons`, { allowEmpty: root.eligible });
  if (root.eligible && exclusions.length) {
    fail("operation_binding_explain_eligible_has_exclusions", `${field} cannot be eligible and excluded.`, 409, { field });
  }
  return {
    binding_id: requiredString(root.binding_id, `${field}.binding_id`, { max: 64 }),
    binding_key: requiredString(root.binding_key, `${field}.binding_key`, { pattern: SAFE_KEY_PATTERN }),
    binding_scope_type: requiredString(root.binding_scope_type, `${field}.binding_scope_type`, { max: 32, pattern: SAFE_KEY_PATTERN }),
    provider_family: optionalString(root.provider_family, `${field}.provider_family`, { max: 128, pattern: SAFE_KEY_PATTERN }),
    eligible: root.eligible,
    selected: root.selected,
    exclusion_reasons: exclusions,
    rank,
    score,
    revision_hash: requiredHash(root.revision_hash, `${field}.revision_hash`),
  };
}

function normalizeTypedExclusion(input, index) {
  const field = `typed_exclusions[${index}]`;
  const root = requiredObject(input, field);
  const allowed = new Set(["binding_id", "binding_key", "exclusion_type", "reason_codes"]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("operation_binding_explain_unknown_exclusion_field", `${field} contains unsupported fields.`, 400, { fields: unknown.sort() });
  }
  return {
    binding_id: requiredString(root.binding_id, `${field}.binding_id`, { max: 64 }),
    binding_key: requiredString(root.binding_key, `${field}.binding_key`, { pattern: SAFE_KEY_PATTERN }),
    exclusion_type: requiredString(root.exclusion_type, `${field}.exclusion_type`, { max: 64, pattern: SAFE_KEY_PATTERN }),
    reason_codes: reasonCodes(root.reason_codes || [], `${field}.reason_codes`, { allowEmpty: false }),
  };
}

function dispositionFor(candidate, selectedId, fallbackIds, overflowIds) {
  if (candidate.binding_id === selectedId) return "selected";
  if (fallbackIds.includes(candidate.binding_id)) return "fallback";
  if (overflowIds.includes(candidate.binding_id)) return "overflow";
  return "excluded";
}

function decisionReasons(candidate, disposition, typedExclusion) {
  if (disposition === "selected") return ["hard_constraints_satisfied", "highest_effective_rank"];
  if (disposition === "fallback") return ["eligible_ordered_fallback"];
  if (disposition === "overflow") return typedExclusion?.reason_codes || ["fallback_limit_exceeded"];
  return candidate.exclusion_reasons;
}

export function buildOperationBindingResolverExplain(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "operation_key", "operation_version", "source_revision_hash", "kill_switch_policy_hash",
    "selected_binding_id", "fallback_binding_ids", "overflow_binding_ids", "typed_exclusions",
    "candidate_evidence",
  ]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("operation_binding_explain_unknown_field", "input contains unsupported fields.", 400, { fields: unknown.sort() });
  }
  if (!Array.isArray(root.candidate_evidence) || root.candidate_evidence.length === 0 || root.candidate_evidence.length > 1000) {
    fail("operation_binding_explain_candidates_invalid", "candidate_evidence must contain between 1 and 1000 entries.");
  }
  const selectedId = requiredString(root.selected_binding_id, "input.selected_binding_id", { max: 64 });
  const fallbackIds = idList(root.fallback_binding_ids || [], "input.fallback_binding_ids");
  const overflowIds = idList(root.overflow_binding_ids || [], "input.overflow_binding_ids");
  const candidates = root.candidate_evidence.map(normalizeCandidateEvidence).sort((left, right) => (
    left.binding_key.localeCompare(right.binding_key) || left.binding_id.localeCompare(right.binding_id)
  ));
  if (new Set(candidates.map((candidate) => candidate.binding_id)).size !== candidates.length) {
    fail("operation_binding_explain_duplicate_candidate_id", "candidate evidence IDs must be unique.", 409);
  }
  if (new Set(candidates.map((candidate) => candidate.binding_key)).size !== candidates.length) {
    fail("operation_binding_explain_duplicate_candidate_key", "candidate evidence keys must be unique.", 409);
  }
  const candidatesById = new Map(candidates.map((candidate) => [candidate.binding_id, candidate]));
  const selected = candidatesById.get(selectedId);
  if (!selected || !selected.eligible || !selected.selected) {
    fail("operation_binding_explain_selected_candidate_invalid", "selected_binding_id must identify the selected eligible candidate.", 409, { selected_binding_id: selectedId });
  }
  const selectedFlags = candidates.filter((candidate) => candidate.selected);
  if (selectedFlags.length !== 1 || selectedFlags[0].binding_id !== selectedId) {
    fail("operation_binding_explain_selected_flags_conflict", "candidate selected flags must match selected_binding_id.", 409);
  }
  const allDispositionIds = [selectedId, ...fallbackIds, ...overflowIds];
  if (new Set(allDispositionIds).size !== allDispositionIds.length) {
    fail("operation_binding_explain_disposition_overlap", "selected, fallback, and overflow IDs must not overlap.", 409);
  }
  for (const bindingId of [...fallbackIds, ...overflowIds]) {
    const candidate = candidatesById.get(bindingId);
    if (!candidate || !candidate.eligible) {
      fail("operation_binding_explain_disposition_candidate_invalid", "fallback and overflow IDs must identify eligible candidates.", 409, { binding_id: bindingId });
    }
  }
  const typedExclusions = (root.typed_exclusions || []).map(normalizeTypedExclusion).sort((left, right) => (
    left.binding_key.localeCompare(right.binding_key) || left.binding_id.localeCompare(right.binding_id)
  ));
  const typedById = new Map(typedExclusions.map((entry) => [entry.binding_id, entry]));
  const explainedCandidates = candidates.map((candidate) => {
    const disposition = dispositionFor(candidate, selectedId, fallbackIds, overflowIds);
    if (!DISPOSITIONS.has(disposition)) {
      fail("operation_binding_explain_disposition_invalid", "candidate disposition is invalid.", 500, { binding_id: candidate.binding_id });
    }
    if (candidate.eligible && disposition === "excluded") {
      fail("operation_binding_explain_eligible_candidate_unassigned", "Every eligible candidate must be selected, fallback, or overflow.", 409, { binding_id: candidate.binding_id });
    }
    if (!candidate.eligible && disposition !== "excluded") {
      fail("operation_binding_explain_ineligible_candidate_assigned", "An excluded candidate cannot be selected or used as fallback.", 409, { binding_id: candidate.binding_id });
    }
    const typedExclusion = typedById.get(candidate.binding_id) || null;
    return {
      binding_id: candidate.binding_id,
      binding_key: candidate.binding_key,
      binding_scope_type: candidate.binding_scope_type,
      provider_family: candidate.provider_family,
      disposition,
      eligible: candidate.eligible,
      selected: disposition === "selected",
      fallback_position: disposition === "fallback" ? fallbackIds.indexOf(candidate.binding_id) + 1 : null,
      typed_exclusion_type: typedExclusion?.exclusion_type || null,
      decision_reason_codes: decisionReasons(candidate, disposition, typedExclusion),
      rank_dimensions: rankDimensions(candidate.rank),
      score: candidate.score,
      revision_hash: candidate.revision_hash,
    };
  });
  const dispositionCounts = Object.fromEntries([...DISPOSITIONS].sort().map((disposition) => [
    disposition,
    explainedCandidates.filter((candidate) => candidate.disposition === disposition).length,
  ]));
  const reportCore = {
    schema_version: "operation-binding-resolver-explain-v1",
    operation_key: requiredString(root.operation_key, "input.operation_key", { pattern: SAFE_KEY_PATTERN }),
    operation_version: Number(root.operation_version),
    source_revision_hash: requiredHash(root.source_revision_hash, "input.source_revision_hash"),
    kill_switch_policy_hash: requiredHash(root.kill_switch_policy_hash, "input.kill_switch_policy_hash"),
    selected_binding_id: selectedId,
    fallback_binding_ids: fallbackIds,
    overflow_binding_ids: overflowIds,
    decision_reason_codes: ["hard_constraints_applied", "eligible_candidates_ranked", "bounded_fallback_planned"],
    candidate_evidence: explainedCandidates,
    summary: {
      candidate_count: explainedCandidates.length,
      eligible_count: explainedCandidates.filter((candidate) => candidate.eligible).length,
      excluded_count: explainedCandidates.filter((candidate) => !candidate.eligible).length,
      disposition_counts: dispositionCounts,
      fail_closed: true,
    },
    explanation_only: true,
    candidate_recomputed: false,
    scoring_recomputed: false,
    selection_authorized: false,
    dispatch_authorized: false,
    fallback_executed: false,
    authority_created: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false,
  };
  if (!Number.isInteger(reportCore.operation_version) || reportCore.operation_version < 1) {
    fail("operation_binding_explain_operation_version_invalid", "input.operation_version must be a positive integer.", 400, { field: "input.operation_version" });
  }
  return {
    ok: true,
    report_type: "operation_binding_resolver_explain",
    ...reportCore,
    explain_hash: stableOperationHash(reportCore),
  };
}
