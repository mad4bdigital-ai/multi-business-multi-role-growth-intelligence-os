import { stableOperationHash } from "./operationRegistryContracts.js";

const METRIC_FIELDS = Object.freeze([
  "quality",
  "reliability",
  "privacy",
  "preference_match",
  "context_reuse",
  "estimated_cost",
  "expected_latency",
  "saturation",
]);

const DIMENSION_SPECS = Object.freeze([
  ["health", "quality", "quality", false],
  ["reliability", "reliability", "reliability", false],
  ["privacy", "privacy", "privacy", false],
  ["preference", "preference_match", "preference_match", false],
  ["context_reuse", "context_reuse", "context_reuse", false],
  ["cost", "estimated_cost", "estimated_cost", true],
  ["latency", "expected_latency", "expected_latency", true],
  ["capacity", "saturation", "saturation", true],
]);

export class OperationBindingScoringError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationBindingScoringError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationBindingScoringError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_binding_scoring_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, max = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) {
    fail("operation_binding_scoring_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function unitInterval(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    fail("operation_binding_scoring_metric_out_of_range", `${field} must be between 0 and 1.`, 400, { field });
  }
  return normalized;
}

function normalizeMetricMap(value, field) {
  const root = requiredObject(value, field);
  const unknown = Object.keys(root).filter((key) => !METRIC_FIELDS.includes(key));
  if (unknown.length) {
    fail("operation_binding_scoring_unknown_metric", `${field} contains unsupported metrics.`, 400, { fields: unknown.sort() });
  }
  return Object.fromEntries(METRIC_FIELDS.map((key) => [key, unitInterval(root[key], `${field}.${key}`)]));
}

function normalizeInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set(["binding_id", "binding_key", "eligible", "metrics", "weights"]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail("operation_binding_scoring_unknown_field", "input contains unsupported fields.", 400, { fields: unknown.sort() });
  }
  if (root.eligible !== true) {
    fail("operation_binding_scoring_candidate_ineligible", "Only hard-constraint-eligible candidates may be scored.", 409, {
      binding_id: root.binding_id || null,
    });
  }
  const metrics = normalizeMetricMap(root.metrics, "input.metrics");
  const weights = normalizeMetricMap(root.weights, "input.weights");
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    fail("operation_binding_scoring_weights_empty", "At least one scoring weight must be positive.");
  }
  return {
    binding_id: requiredString(root.binding_id, "input.binding_id", 64),
    binding_key: requiredString(root.binding_key, "input.binding_key"),
    metrics,
    weights,
  };
}

function rounded(value, digits = 8) {
  return Number(Number(value).toFixed(digits));
}

export function scoreOperationBindingCandidate(input = {}) {
  const normalized = normalizeInput(input);
  const dimensions = {};
  let total = 0;
  for (const [dimension, metricKey, weightKey, invert] of DIMENSION_SPECS) {
    const rawMetric = normalized.metrics[metricKey];
    const normalizedValue = invert ? 1 - rawMetric : rawMetric;
    const weight = normalized.weights[weightKey];
    const contribution = normalizedValue * weight;
    total += contribution;
    dimensions[dimension] = {
      source_metric: metricKey,
      raw_metric: rounded(rawMetric),
      normalized_value: rounded(normalizedValue),
      weight: rounded(weight),
      contribution: rounded(contribution),
    };
  }
  const score = Number(total.toFixed(6));
  const evidenceCore = {
    schema_version: "operation-binding-score-evidence-v1",
    binding_id: normalized.binding_id,
    binding_key: normalized.binding_key,
    dimensions,
    score,
    eligible: true,
    candidate_selected: false,
    selection_authorized: false,
    fallback_performed: false,
    authority_created: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false,
  };
  return {
    ...evidenceCore,
    evidence_hash: stableOperationHash(evidenceCore),
  };
}

export function scoreOperationBindingCandidates({ candidates = [], weights = {} } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 1000) {
    fail("operation_binding_scoring_candidates_invalid", "candidates must contain between 1 and 1000 eligible candidates.");
  }
  const evidence = candidates.map((candidate) => scoreOperationBindingCandidate({
    binding_id: candidate.binding_id,
    binding_key: candidate.binding_key,
    eligible: candidate.eligible,
    metrics: candidate.metrics,
    weights,
  })).sort((left, right) => left.binding_key.localeCompare(right.binding_key) || left.binding_id.localeCompare(right.binding_id));
  return {
    ok: true,
    report_type: "operation_binding_scoring",
    candidate_scores: evidence,
    candidate_count: evidence.length,
    candidate_selected: false,
    selection_authorized: false,
    fallback_performed: false,
    authority_created: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false,
    report_hash: stableOperationHash(evidence.map((entry) => ({ binding_id: entry.binding_id, evidence_hash: entry.evidence_hash }))),
  };
}
