import { stableOperationHash } from "./operationRegistryContracts.js";

const COMPILE_MODES = new Set(["shadow", "active"]);
const SCOPE_TYPES = new Set(["platform", "tenant", "workspace", "resource"]);
const BINDING_STATUSES = new Set(["draft", "shadow", "active", "degraded", "disabled", "archived"]);
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_FIELD_PATTERN = /(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie|credential_payload)/i;
const HARD_GATES = Object.freeze([
  ["dispatch_allowed", "dispatch_not_allowed"],
  ["endpoint_export_ready", "endpoint_export_not_ready"],
  ["capability_available", "capability_unavailable"],
  ["resource_authorized", "resource_authority_missing"],
  ["credential_ready", "credential_not_ready"],
  ["adapter_healthy", "adapter_unhealthy"],
  ["capacity_available", "capacity_unavailable"],
  ["effect_allowed", "effect_not_allowed"],
]);

export class OperationBindingEligibilityError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationBindingEligibilityError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationBindingEligibilityError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, field) {
  if (!isObject(value)) fail("operation_binding_eligibility_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function scanForSecrets(value, field = "input", depth = 0) {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (depth > 20) fail("operation_binding_eligibility_input_too_deep", `${field} exceeds the maximum depth.`, 400, { field });
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForSecrets(entry, `${field}[${index}]`, depth + 1));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (nested !== false) {
        fail("operation_binding_eligibility_safety_marker_invalid", `${childField} must be false.`, 400, { field: childField });
      }
      continue;
    }
    if (SECRET_FIELD_PATTERN.test(key)) {
      fail("operation_binding_eligibility_secret_field_forbidden", `${childField} is secret-bearing.`, 400, { field: childField });
    }
    scanForSecrets(nested, childField, depth + 1);
  }
}

function stringValue(value, field, { optional = false, max = 191, pattern = null } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_binding_eligibility_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") fail("operation_binding_eligibility_invalid_boolean", `${field} must be boolean.`, 400, { field });
  return value;
}

function hashValue(value, field) {
  const normalized = stringValue(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_binding_eligibility_invalid_hash", `${field} must be SHA-256.`, 400, { field });
  return normalized;
}

function isoDate(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = stringValue(value, field, { max: 64 });
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) fail("operation_binding_eligibility_invalid_timestamp", `${field} must be ISO-8601 compatible.`, 400, { field });
  return new Date(timestamp).toISOString();
}

function denyReasons(value, field) {
  if (!Array.isArray(value) || value.length > 50) {
    fail("operation_binding_eligibility_deny_reasons_invalid", `${field} must contain at most 50 items.`, 400, { field });
  }
  return [...new Set(value.map((reason, index) => stringValue(reason, `${field}[${index}]`, { max: 128, pattern: SAFE_KEY_PATTERN })))].sort();
}

function normalizeContext(input) {
  const value = object(input, "context");
  scanForSecrets(value, "context");
  const compileMode = stringValue(value.compile_mode, "context.compile_mode", { max: 32 }).toLowerCase();
  if (!COMPILE_MODES.has(compileMode)) {
    fail("operation_binding_eligibility_compile_mode_invalid", "context.compile_mode is unsupported.", 400, { compile_mode: compileMode });
  }
  return {
    compile_mode: compileMode,
    now: isoDate(value.now, "context.now"),
    resource_ref: stringValue(value.resource_ref, "context.resource_ref", { optional: true, max: 500 }),
    workspace_id: stringValue(value.workspace_id, "context.workspace_id", { optional: true }),
    tenant_id: stringValue(value.tenant_id, "context.tenant_id", { optional: true }),
    provider_family: stringValue(value.provider_family, "context.provider_family", { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    required_capability_key: stringValue(value.required_capability_key, "context.required_capability_key", { optional: true, pattern: SAFE_KEY_PATTERN }),
    expected_effect_class: stringValue(value.expected_effect_class, "context.expected_effect_class", { optional: true, pattern: SAFE_KEY_PATTERN }),
  };
}

function normalizeCandidate(input, index) {
  const field = `candidates[${index}]`;
  const value = object(input, field);
  scanForSecrets(value, field);
  const bindingScopeType = stringValue(value.binding_scope_type, `${field}.binding_scope_type`, { max: 32 }).toLowerCase();
  if (!SCOPE_TYPES.has(bindingScopeType)) {
    fail("operation_binding_eligibility_scope_type_invalid", `${field}.binding_scope_type is unsupported.`, 400, { field });
  }
  const status = stringValue(value.status, `${field}.status`, { max: 32 }).toLowerCase();
  if (!BINDING_STATUSES.has(status)) {
    fail("operation_binding_eligibility_status_invalid", `${field}.status is unsupported.`, 400, { field });
  }
  const candidate = {
    binding_id: stringValue(value.binding_id, `${field}.binding_id`, { max: 64 }),
    binding_key: stringValue(value.binding_key, `${field}.binding_key`, { pattern: SAFE_KEY_PATTERN }),
    binding_scope_type: bindingScopeType,
    scope_ref: stringValue(value.scope_ref, `${field}.scope_ref`, { optional: true, max: 500 }),
    provider_family: stringValue(value.provider_family, `${field}.provider_family`, { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    capability_key: stringValue(value.capability_key, `${field}.capability_key`, { optional: true, pattern: SAFE_KEY_PATTERN }),
    effect_class: stringValue(value.effect_class, `${field}.effect_class`, { optional: true, max: 128, pattern: SAFE_KEY_PATTERN }),
    status,
    valid_from: isoDate(value.valid_from, `${field}.valid_from`, { optional: true }),
    valid_until: isoDate(value.valid_until, `${field}.valid_until`, { optional: true }),
    revision_hash: hashValue(value.revision_hash, `${field}.revision_hash`),
    denied: booleanValue(value.denied, `${field}.denied`),
    deny_reasons: denyReasons(value.deny_reasons, `${field}.deny_reasons`),
    requires_approval: booleanValue(value.requires_approval, `${field}.requires_approval`),
    requires_readback: booleanValue(value.requires_readback, `${field}.requires_readback`),
    approval_ready: booleanValue(value.approval_ready, `${field}.approval_ready`),
    readback_ready: booleanValue(value.readback_ready, `${field}.readback_ready`),
  };
  for (const [gate] of HARD_GATES) candidate[gate] = booleanValue(value[gate], `${field}.${gate}`);
  if (candidate.valid_from && candidate.valid_until && Date.parse(candidate.valid_from) >= Date.parse(candidate.valid_until)) {
    fail("operation_binding_eligibility_validity_window_invalid", `${field} has an invalid validity window.`, 400, { field });
  }
  return candidate;
}

function scopeMatches(candidate, context) {
  const expected = { resource: context.resource_ref, workspace: context.workspace_id, tenant: context.tenant_id, platform: null };
  if (candidate.binding_scope_type === "platform") return candidate.scope_ref === null;
  return Boolean(expected[candidate.binding_scope_type]) && candidate.scope_ref === expected[candidate.binding_scope_type];
}

function evaluateNormalizedCandidate(candidate, context) {
  const reasons = [];
  if (candidate.denied || candidate.deny_reasons.length > 0) reasons.push("policy_denied");
  reasons.push(...candidate.deny_reasons.map((reason) => `deny:${reason}`));
  const allowedStatuses = context.compile_mode === "active" ? new Set(["active"]) : new Set(["shadow", "active"]);
  if (!allowedStatuses.has(candidate.status)) reasons.push("lifecycle_not_eligible");
  const now = Date.parse(context.now);
  if (candidate.valid_from && now < Date.parse(candidate.valid_from)) reasons.push("not_yet_valid");
  if (candidate.valid_until && now >= Date.parse(candidate.valid_until)) reasons.push("expired");
  if (!scopeMatches(candidate, context)) reasons.push("scope_mismatch");
  if (context.provider_family) {
    if (candidate.provider_family && candidate.provider_family !== context.provider_family) reasons.push("provider_family_mismatch");
  } else if (candidate.provider_family) reasons.push("provider_context_missing");
  if (context.required_capability_key && candidate.capability_key !== context.required_capability_key) reasons.push("capability_mismatch");
  if (context.expected_effect_class && candidate.effect_class !== context.expected_effect_class) reasons.push("effect_class_mismatch");
  for (const [gate, reason] of HARD_GATES) if (!candidate[gate]) reasons.push(reason);
  if (candidate.requires_approval && !candidate.approval_ready) reasons.push("approval_not_ready");
  if (candidate.requires_readback && !candidate.readback_ready) reasons.push("readback_not_ready");
  return [...new Set(reasons)].sort();
}

function safeEvidence(candidate, exclusionReasons) {
  return {
    binding_id: candidate.binding_id,
    binding_key: candidate.binding_key,
    binding_scope_type: candidate.binding_scope_type,
    provider_family: candidate.provider_family,
    capability_key: candidate.capability_key,
    effect_class: candidate.effect_class,
    status: candidate.status,
    eligible: exclusionReasons.length === 0,
    exclusion_reasons: exclusionReasons,
    revision_hash: candidate.revision_hash,
  };
}

export function evaluateOperationBindingHardConstraints(candidate, context) {
  return evaluateNormalizedCandidate(normalizeCandidate(candidate, 0), normalizeContext(context));
}

export function filterOperationBindingEligibility({ candidates = [], context = {} } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 1000) {
    fail("operation_binding_eligibility_candidates_invalid", "candidates must contain between 1 and 1000 bindings.");
  }
  const normalizedContext = normalizeContext(context);
  const normalizedCandidates = candidates.map(normalizeCandidate).sort((left, right) => (
    left.binding_key.localeCompare(right.binding_key) || left.binding_id.localeCompare(right.binding_id)
  ));
  if (new Set(normalizedCandidates.map((candidate) => candidate.binding_id)).size !== normalizedCandidates.length) {
    fail("operation_binding_eligibility_duplicate_id", "candidate binding IDs must be unique.");
  }
  if (new Set(normalizedCandidates.map((candidate) => candidate.binding_key)).size !== normalizedCandidates.length) {
    fail("operation_binding_eligibility_duplicate_key", "candidate binding keys must be unique.");
  }
  const candidateEvidence = normalizedCandidates.map((candidate) => {
    const exclusionReasons = evaluateNormalizedCandidate(candidate, normalizedContext);
    return safeEvidence(candidate, exclusionReasons);
  });
  const eligibleBindingIds = candidateEvidence.filter((entry) => entry.eligible).map((entry) => entry.binding_id);
  const excludedBindingIds = candidateEvidence.filter((entry) => !entry.eligible).map((entry) => entry.binding_id);
  const reportCore = {
    schema_version: "operation-binding-eligibility-report-v1",
    constraints_version: "operation-binding-hard-constraints-v1",
    compile_mode: normalizedContext.compile_mode,
    scope_fingerprint: stableOperationHash({ resource_ref: normalizedContext.resource_ref, workspace_id: normalizedContext.workspace_id, tenant_id: normalizedContext.tenant_id }),
    eligible_binding_ids: eligibleBindingIds,
    excluded_binding_ids: excludedBindingIds,
    candidate_evidence: candidateEvidence,
    summary: { candidate_count: candidateEvidence.length, eligible_count: eligibleBindingIds.length, excluded_count: excludedBindingIds.length, fail_closed: true },
    candidate_selected: false,
    selection_authorized: false,
    scoring_performed: false,
    fallback_performed: false,
    preferences_applied: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false,
  };
  return { ok: true, report_type: "operation_binding_eligibility", ...reportCore, report_hash: stableOperationHash(reportCore) };
}
