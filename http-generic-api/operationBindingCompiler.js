import { stableOperationHash } from "./operationRegistryContracts.js";
import { filterOperationBindingEligibility } from "./operationBindingEligibility.js";
import { scoreOperationBindingCandidate } from "./operationBindingScoring.js";
import { buildOperationBindingFallbackPlan } from "./operationBindingFallback.js";
import { buildOperationBindingResolverExplain } from "./operationBindingResolverExplain.js";

const SCOPE_RANK = Object.freeze({ platform: 1, tenant: 2, workspace: 3, resource: 4 });
const COMPILE_MODES = new Set(["shadow", "active"]);
const BINDING_STATUSES = new Set(["draft", "shadow", "active", "degraded", "disabled", "archived"]);
const CANDIDATE_FIELDS = new Set([
  "binding_id", "binding_key", "binding_scope_type", "scope_ref", "provider_family", "effect_class",
  "adapter_key", "runtime_key", "capability_key", "dispatch_binding_key", "endpoint_export_key",
  "resource_authority_recipe_key", "approval_policy_key", "readback_policy_key", "priority", "fallback_rank",
  "requires_approval", "requires_readback", "valid_from", "valid_until", "status", "revision_hash", "denied",
  "deny_reasons", "dispatch_allowed", "endpoint_export_ready", "capability_available", "resource_authorized",
  "credential_ready", "adapter_healthy", "capacity_available", "effect_allowed", "approval_ready",
  "readback_ready", "metrics"
]);
const METRIC_FIELDS = new Set([
  "quality", "reliability", "privacy", "preference_match", "context_reuse", "estimated_cost",
  "expected_latency", "saturation"
]);
const DEFAULT_WEIGHTS = Object.freeze({
  quality: 0.2, reliability: 0.2, privacy: 0.15, preference_match: 0.1, context_reuse: 0.1,
  estimated_cost: 0.1, expected_latency: 0.1, saturation: 0.05
});
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_FIELD_PATTERN = /(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie|credential_payload)/i;

export class OperationBindingCompilerError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationBindingCompilerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationBindingCompilerError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, field) {
  if (!isObject(value)) fail("operation_binding_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function allowedKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      fail("operation_binding_secret_field_forbidden", `${field}.${key} is secret-bearing.`, 400, { field: `${field}.${key}` });
    }
    if (!allowed.has(key)) {
      fail("operation_binding_unknown_field", `${field}.${key} is not supported.`, 400, { field: `${field}.${key}` });
    }
  }
}

function stringValue(value, field, { optional = false, max = 191, pattern = null } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_binding_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function booleanValue(value, field, { defaultValue = null } = {}) {
  if (value === undefined && defaultValue !== null) return defaultValue;
  if (typeof value !== "boolean") fail("operation_binding_invalid_boolean", `${field} must be boolean.`, 400, { field });
  return value;
}

function integerValue(value, field, { min = -1000000, max = 1000000 } = {}) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    fail("operation_binding_invalid_integer", `${field} is invalid.`, 400, { field, min, max });
  }
  return normalized;
}

function hashValue(value, field) {
  const normalized = stringValue(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_binding_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  return normalized;
}

function isoDate(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = stringValue(value, field, { max: 64 });
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) fail("operation_binding_invalid_timestamp", `${field} must be ISO-8601 compatible.`, 400, { field });
  return new Date(timestamp).toISOString();
}

function unitInterval(value, field) {
  if (value === undefined || value === null) return 0;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    fail("operation_binding_metric_out_of_range", `${field} must be between 0 and 1.`, 400, { field });
  }
  return normalized;
}

function normalizeMetrics(input, field) {
  const value = input === undefined || input === null ? {} : object(input, field);
  allowedKeys(value, METRIC_FIELDS, field);
  return Object.fromEntries([...METRIC_FIELDS].sort().map((key) => [key, unitInterval(value[key], `${field}.${key}`)]));
}

function normalizeWeights(input = null) {
  const value = input === undefined || input === null ? DEFAULT_WEIGHTS : object(input, "policy.weights");
  allowedKeys(value, METRIC_FIELDS, "policy.weights");
  const weights = Object.fromEntries([...METRIC_FIELDS].sort().map((key) => [
    key, unitInterval(value[key] ?? DEFAULT_WEIGHTS[key], `policy.weights.${key}`)
  ]));
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) fail("operation_binding_weights_empty", "At least one scoring weight must be positive.");
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, Number((weight / total).toFixed(8))]));
}

function normalizeOperation(input) {
  const value = object(input, "operation");
  const allowed = new Set(["operation_key", "version", "revision_hash", "operation_class", "risk_level"]);
  allowedKeys(value, allowed, "operation");
  return {
    operation_key: stringValue(value.operation_key, "operation.operation_key", { pattern: SAFE_KEY_PATTERN }),
    version: integerValue(value.version, "operation.version", { min: 1, max: 2147483647 }),
    revision_hash: hashValue(value.revision_hash, "operation.revision_hash"),
    operation_class: stringValue(value.operation_class, "operation.operation_class", { pattern: SAFE_KEY_PATTERN }),
    risk_level: stringValue(value.risk_level, "operation.risk_level", { pattern: SAFE_KEY_PATTERN })
  };
}

function normalizeContext(input) {
  const value = object(input, "context");
  const allowed = new Set([
    "compile_mode", "now", "resource_ref", "workspace_id", "tenant_id", "provider_family",
    "required_capability_key", "expected_effect_class"
  ]);
  allowedKeys(value, allowed, "context");
  const compileMode = stringValue(value.compile_mode || "shadow", "context.compile_mode", { max: 32 }).toLowerCase();
  if (!COMPILE_MODES.has(compileMode)) fail("operation_binding_compile_mode_invalid", "context.compile_mode is unsupported.", 400, { compile_mode: compileMode });
  return {
    compile_mode: compileMode,
    now: isoDate(value.now, "context.now"),
    resource_ref: stringValue(value.resource_ref, "context.resource_ref", { optional: true, max: 500 }),
    workspace_id: stringValue(value.workspace_id, "context.workspace_id", { optional: true }),
    tenant_id: stringValue(value.tenant_id, "context.tenant_id", { optional: true }),
    provider_family: stringValue(value.provider_family, "context.provider_family", { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    required_capability_key: stringValue(value.required_capability_key, "context.required_capability_key", { optional: true, pattern: SAFE_KEY_PATTERN }),
    expected_effect_class: stringValue(value.expected_effect_class, "context.expected_effect_class", { optional: true, pattern: SAFE_KEY_PATTERN })
  };
}

function normalizeDenyReasons(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) fail("operation_binding_deny_reasons_invalid", `${field} must contain at most 50 items.`, 400, { field });
  return [...new Set(value.map((item, index) => stringValue(item, `${field}[${index}]`, { max: 128, pattern: SAFE_KEY_PATTERN })))].sort();
}

function normalizeCandidate(input, index) {
  const field = `candidates[${index}]`;
  const value = object(input, field);
  allowedKeys(value, CANDIDATE_FIELDS, field);
  const scopeType = stringValue(value.binding_scope_type, `${field}.binding_scope_type`, { max: 32 }).toLowerCase();
  if (!(scopeType in SCOPE_RANK)) fail("operation_binding_scope_type_invalid", `${field}.binding_scope_type is unsupported.`, 400, { field });
  const status = stringValue(value.status, `${field}.status`, { max: 32 }).toLowerCase();
  if (!BINDING_STATUSES.has(status)) fail("operation_binding_status_invalid", `${field}.status is unsupported.`, 400, { field });
  const candidate = {
    binding_id: stringValue(value.binding_id, `${field}.binding_id`, { max: 64 }),
    binding_key: stringValue(value.binding_key, `${field}.binding_key`, { pattern: SAFE_KEY_PATTERN }),
    binding_scope_type: scopeType,
    scope_ref: stringValue(value.scope_ref, `${field}.scope_ref`, { optional: true, max: 500 }),
    provider_family: stringValue(value.provider_family, `${field}.provider_family`, { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    effect_class: stringValue(value.effect_class, `${field}.effect_class`, { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    adapter_key: stringValue(value.adapter_key, `${field}.adapter_key`, { pattern: SAFE_KEY_PATTERN }),
    runtime_key: stringValue(value.runtime_key, `${field}.runtime_key`, { pattern: SAFE_KEY_PATTERN }),
    capability_key: stringValue(value.capability_key, `${field}.capability_key`, { optional: true, pattern: SAFE_KEY_PATTERN }),
    dispatch_binding_key: stringValue(value.dispatch_binding_key, `${field}.dispatch_binding_key`, { pattern: SAFE_KEY_PATTERN }),
    endpoint_export_key: stringValue(value.endpoint_export_key, `${field}.endpoint_export_key`, { pattern: SAFE_KEY_PATTERN }),
    resource_authority_recipe_key: stringValue(value.resource_authority_recipe_key, `${field}.resource_authority_recipe_key`, { optional: true, pattern: SAFE_KEY_PATTERN }),
    approval_policy_key: stringValue(value.approval_policy_key, `${field}.approval_policy_key`, { optional: true, pattern: SAFE_KEY_PATTERN }),
    readback_policy_key: stringValue(value.readback_policy_key, `${field}.readback_policy_key`, { optional: true, pattern: SAFE_KEY_PATTERN }),
    priority: integerValue(value.priority ?? 100, `${field}.priority`),
    fallback_rank: integerValue(value.fallback_rank ?? 0, `${field}.fallback_rank`, { min: 0, max: 1000000 }),
    requires_approval: booleanValue(value.requires_approval, `${field}.requires_approval`),
    requires_readback: booleanValue(value.requires_readback, `${field}.requires_readback`),
    valid_from: isoDate(value.valid_from, `${field}.valid_from`, { optional: true }),
    valid_until: isoDate(value.valid_until, `${field}.valid_until`, { optional: true }),
    status,
    revision_hash: hashValue(value.revision_hash, `${field}.revision_hash`),
    denied: booleanValue(value.denied, `${field}.denied`, { defaultValue: false }),
    deny_reasons: normalizeDenyReasons(value.deny_reasons, `${field}.deny_reasons`),
    dispatch_allowed: booleanValue(value.dispatch_allowed, `${field}.dispatch_allowed`),
    endpoint_export_ready: booleanValue(value.endpoint_export_ready, `${field}.endpoint_export_ready`),
    capability_available: booleanValue(value.capability_available, `${field}.capability_available`),
    resource_authorized: booleanValue(value.resource_authorized, `${field}.resource_authorized`),
    credential_ready: booleanValue(value.credential_ready, `${field}.credential_ready`),
    adapter_healthy: booleanValue(value.adapter_healthy, `${field}.adapter_healthy`),
    capacity_available: booleanValue(value.capacity_available, `${field}.capacity_available`),
    effect_allowed: booleanValue(value.effect_allowed, `${field}.effect_allowed`),
    approval_ready: booleanValue(value.approval_ready, `${field}.approval_ready`),
    readback_ready: booleanValue(value.readback_ready, `${field}.readback_ready`),
    metrics: normalizeMetrics(value.metrics, `${field}.metrics`)
  };
  if (candidate.valid_from && candidate.valid_until && Date.parse(candidate.valid_from) >= Date.parse(candidate.valid_until)) {
    fail("operation_binding_validity_window_invalid", `${field} has an invalid validity window.`, 400, { field });
  }
  return candidate;
}

function scoreCandidate(candidate, weights) {
  return scoreOperationBindingCandidate({
    binding_id: candidate.binding_id,
    binding_key: candidate.binding_key,
    eligible: true,
    metrics: candidate.metrics,
    weights,
  }).score;
}

function rankCandidate(candidate, context, score) {
  const providerRank = context.provider_family ? (candidate.provider_family === context.provider_family ? 2 : 1) : 1;
  const capabilityRank = context.required_capability_key ? (candidate.capability_key === context.required_capability_key ? 1 : 0) : 1;
  return [SCOPE_RANK[candidate.binding_scope_type], providerRank, capabilityRank, candidate.priority, -candidate.fallback_rank, score];
}

function compareRank(left, right) {
  for (let index = 0; index < left.rank.length; index += 1) {
    const delta = right.rank[index] - left.rank[index];
    if (delta !== 0) return delta;
  }
  return left.candidate.binding_key.localeCompare(right.candidate.binding_key);
}

function sameRank(left, right) {
  return left.rank.every((value, index) => value === right.rank[index]);
}

function safeBinding(candidate) {
  return {
    binding_id: candidate.binding_id,
    binding_key: candidate.binding_key,
    binding_scope_type: candidate.binding_scope_type,
    scope_ref_hash: candidate.scope_ref ? stableOperationHash({ binding_scope_type: candidate.binding_scope_type, scope_ref: candidate.scope_ref }) : null,
    provider_family: candidate.provider_family,
    effect_class: candidate.effect_class,
    adapter_key: candidate.adapter_key,
    runtime_key: candidate.runtime_key,
    capability_key: candidate.capability_key,
    dispatch_binding_key: candidate.dispatch_binding_key,
    endpoint_export_key: candidate.endpoint_export_key,
    resource_authority_recipe_key: candidate.resource_authority_recipe_key,
    approval_policy_key: candidate.approval_policy_key,
    readback_policy_key: candidate.readback_policy_key,
    priority: candidate.priority,
    fallback_rank: candidate.fallback_rank,
    requires_approval: candidate.requires_approval,
    requires_readback: candidate.requires_readback,
    revision_hash: candidate.revision_hash
  };
}

function safeEvidence(entry, selectedBindingId) {
  return {
    binding_id: entry.candidate.binding_id,
    binding_key: entry.candidate.binding_key,
    binding_scope_type: entry.candidate.binding_scope_type,
    provider_family: entry.candidate.provider_family,
    eligible: entry.eligible,
    selected: entry.candidate.binding_id === selectedBindingId,
    exclusion_reasons: entry.exclusion_reasons,
    rank: entry.eligible ? entry.rank : null,
    score: entry.eligible ? entry.score : null,
    revision_hash: entry.candidate.revision_hash
  };
}

export function compileOperationBindingManifest(input = {}) {
  const root = object(input, "input");
  allowedKeys(root, new Set(["operation", "context", "candidates", "compiler_version", "policy"]), "input");
  const operation = normalizeOperation(root.operation);
  const context = normalizeContext(root.context);
  if (!Array.isArray(root.candidates) || root.candidates.length === 0 || root.candidates.length > 1000) {
    fail("operation_binding_candidates_invalid", "candidates must contain between 1 and 1000 bindings.");
  }
  const compilerVersion = stringValue(root.compiler_version || "operation-binding-compiler-v1", "compiler_version", { max: 64, pattern: SAFE_KEY_PATTERN });
  const policy = root.policy === undefined || root.policy === null ? {} : object(root.policy, "policy");
  allowedKeys(policy, new Set(["weights"]), "policy");
  const weights = normalizeWeights(policy.weights);
  const candidates = root.candidates.map(normalizeCandidate).sort((left, right) => left.binding_key.localeCompare(right.binding_key));
  if (new Set(candidates.map((candidate) => candidate.binding_id)).size !== candidates.length) fail("operation_binding_duplicate_id", "candidate binding IDs must be unique.");
  if (new Set(candidates.map((candidate) => candidate.binding_key)).size !== candidates.length) fail("operation_binding_duplicate_key", "candidate binding keys must be unique.");
  const eligibilityReport = filterOperationBindingEligibility({ candidates, context });
  const eligibilityByBindingId = new Map(eligibilityReport.candidate_evidence.map((entry) => [entry.binding_id, entry.exclusion_reasons]));
  const evaluated = candidates.map((candidate) => {
    const exclusionReasons = eligibilityByBindingId.get(candidate.binding_id) || [];
    const eligible = exclusionReasons.length === 0;
    const score = eligible ? scoreCandidate(candidate, weights) : null;
    return { candidate, eligible, exclusion_reasons: exclusionReasons, score, rank: eligible ? rankCandidate(candidate, context, score) : null };
  });
  const fallbackPlan = buildOperationBindingFallbackPlan({
    candidates: evaluated.map((entry) => ({
      binding_id: entry.candidate.binding_id,
      binding_key: entry.candidate.binding_key,
      eligible: entry.eligible,
      rank: entry.rank,
      score: entry.score,
      exclusion_reasons: entry.exclusion_reasons,
    })),
  });
  const evaluatedByBindingId = new Map(evaluated.map((entry) => [entry.candidate.binding_id, entry]));
  const eligible = fallbackPlan.ordered_binding_ids.map((bindingId) => evaluatedByBindingId.get(bindingId));
  const preselectionEvidence = evaluated.map((entry) => safeEvidence(entry, null)).sort((left, right) => left.binding_key.localeCompare(right.binding_key));
  if (eligible.length === 0) {
    fail("operation_binding_no_eligible_candidate", "No execution binding satisfies the hard eligibility constraints.", 409, {
      operation_key: operation.operation_key, operation_version: operation.version, candidate_evidence: preselectionEvidence, secrets_included: false
    });
  }
  if (eligible.length > 1 && sameRank(eligible[0], eligible[1])) {
    fail("blocked_ambiguous_binding", "Multiple execution bindings share the highest effective rank.", 409, {
      operation_key: operation.operation_key,
      operation_version: operation.version,
      conflicting_bindings: eligible.filter((entry) => sameRank(entry, eligible[0])).map((entry) => ({
        binding_id: entry.candidate.binding_id, binding_key: entry.candidate.binding_key, revision_hash: entry.candidate.revision_hash
      })),
      candidate_evidence: preselectionEvidence,
      secrets_included: false
    });
  }
  const selected = eligible[0];
  const fallbackEntries = fallbackPlan.fallback_binding_ids.map((bindingId) => evaluatedByBindingId.get(bindingId));
  const candidateEvidence = evaluated.map((entry) => safeEvidence(entry, selected.candidate.binding_id)).sort((left, right) => left.binding_key.localeCompare(right.binding_key));
  const sourceRevisionHash = stableOperationHash({
    operation,
    context,
    candidates,
    policy: { weights },
    kill_switch_policy_hash: eligibilityReport.kill_switch_policy_hash,
    compiler_version: compilerVersion,
  });
  const resolverExplain = buildOperationBindingResolverExplain({
    operation_key: operation.operation_key,
    operation_version: operation.version,
    source_revision_hash: sourceRevisionHash,
    kill_switch_policy_hash: eligibilityReport.kill_switch_policy_hash,
    selected_binding_id: selected.candidate.binding_id,
    fallback_binding_ids: fallbackPlan.fallback_binding_ids,
    overflow_binding_ids: fallbackPlan.overflow_binding_ids,
    typed_exclusions: fallbackPlan.typed_exclusions,
    candidate_evidence: candidateEvidence,
  });
  const manifestCore = {
    schema_version: "operation-binding-manifest-v1",
    compiler_version: compilerVersion,
    compiled_at: context.now,
    compile_mode: context.compile_mode,
    kill_switch_policy_hash: eligibilityReport.kill_switch_policy_hash,
    operation,
    scope_fingerprint: stableOperationHash({ resource_ref: context.resource_ref, workspace_id: context.workspace_id, tenant_id: context.tenant_id }),
    source_revision_hash: sourceRevisionHash,
    selected_binding: { ...safeBinding(selected.candidate), rank: selected.rank, score: selected.score },
    fallback_bindings: fallbackEntries.map((entry) => ({ ...safeBinding(entry.candidate), rank: entry.rank, score: entry.score })),
    fallback_plan: {
      schema_version: fallbackPlan.schema_version,
      max_fallbacks: fallbackPlan.max_fallbacks,
      primary_binding_id: fallbackPlan.primary_binding_id,
      fallback_binding_ids: fallbackPlan.fallback_binding_ids,
      overflow_binding_ids: fallbackPlan.overflow_binding_ids,
      typed_exclusions: fallbackPlan.typed_exclusions,
      summary: fallbackPlan.summary,
      primary_selected_by_plan: fallbackPlan.primary_selected_by_plan,
      selection_authorized: fallbackPlan.selection_authorized,
      fallback_executed: fallbackPlan.fallback_executed,
      dispatch_authorized: fallbackPlan.dispatch_authorized,
      authority_created: fallbackPlan.authority_created,
      report_hash: fallbackPlan.report_hash,
    },
    candidate_evidence: candidateEvidence,
    resolution_summary: {
      candidate_count: evaluated.length,
      eligible_count: eligible.length,
      excluded_count: evaluated.length - eligible.length,
      kill_switch_excluded_count: eligibilityReport.summary.kill_switch_excluded_count,
      fallback_count: fallbackPlan.summary.fallback_count,
      fallback_overflow_count: fallbackPlan.summary.overflow_count,
      fallback_truncated: fallbackPlan.summary.fallback_truncated,
      ambiguity_rejected: false,
      fail_closed: true,
    },
    scoring_policy: { weights },
    safety: { provider_calls_performed: false, credential_payloads_read: false, external_writes_performed: false, runtime_activation_changed: false, secrets_included: false }
  };
  return { ...manifestCore, manifest_hash: stableOperationHash(manifestCore) };
}

export const resolveOperationBinding = compileOperationBindingManifest;
