import { createHash } from "node:crypto";
import {
  GovernedPolicyError,
  stableGovernedPolicySha256,
} from "../governedPolicyQuestionnaireEngine.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SEVERITIES = Object.freeze(["info", "low", "medium", "high", "critical"]);
const WEIGHT = Object.freeze({ info: 1, low: 2, medium: 3, high: 4, critical: 5 });
const OPERATION_STATUSES = Object.freeze([
  "created", "authenticating", "authorized", "resolving_session", "bootstrapping",
  "validating", "preparing_tools", "ready", "executing", "readback_pending",
  "delivery_pending", "acknowledgement_pending", "retry_scheduled", "unknown_outcome",
  "reconciling", "active", "degraded", "authorization_gated",
  "validation_rate_limited", "contract_degraded", "failed", "cancelled", "rolled_back",
]);
const DEPLOYMENT_STATES = Object.freeze(["current", "deploying", "stale", "diverged", "unknown"]);
const DEFAULT_OPERATION = Object.freeze({
  degraded: "medium",
  authorization_gated: "medium",
  validation_rate_limited: "medium",
  contract_degraded: "high",
  failed: "high",
  unknown_outcome: "high",
  reconciling: "medium",
  retry_scheduled: "low",
  delivery_pending: "low",
  acknowledgement_pending: "info",
});
const DEFAULT_DEPLOYMENT = Object.freeze({
  current: null,
  deploying: "info",
  stale: "medium",
  diverged: "high",
  unknown: "medium",
});

function fail(code, message, status = 422, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}
function canonical(value, field) {
  const result = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(result)) fail("activation_attention_invalid_key", `${field} must be canonical.`, 422, { field });
  return result;
}
function identifier(value, field) {
  const result = String(value ?? "").trim();
  if (!ID_RE.test(result)) fail("activation_attention_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  return result;
}
function severity(value, field, nullable = false) {
  if (nullable && value == null) return null;
  const result = String(value ?? "").trim().toLowerCase();
  if (!SEVERITIES.includes(result)) fail("activation_attention_invalid_severity", `${field} is unsupported.`, 422, { field });
  return result;
}
function boundedInteger(value, field, minimum, maximum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) fail("activation_attention_out_of_bounds", `${field} is outside bounds.`, 422, { field, minimum, maximum });
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach((nested) => freeze(nested));
    Object.freeze(value);
  }
  return value;
}
function mapping(source, catalog, defaults, field) {
  const input = source == null ? {} : source;
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("activation_attention_mapping_invalid", `${field} must be an object.`, 422, { field });
  const unknown = Object.keys(input).filter((key) => !catalog.includes(key));
  if (unknown.length) fail("activation_attention_mapping_invalid", `${field} contains unsupported keys.`, 422, { field, keys: unknown.sort() });
  return freeze(Object.fromEntries(catalog.map((key) => [key, severity(Object.hasOwn(input, key) ? input[key] : defaults[key] ?? null, `${field}.${key}`, true)])));
}

function compilePolicy({ input }) {
  const answers = input.normalized_answers ?? {};
  const policy = {
    policy_type: "activation_operational_attention_policy",
    operation_status_severity: mapping(answers.operation_status_severity, OPERATION_STATUSES, DEFAULT_OPERATION, "answers.operation_status_severity"),
    deployment_state_severity: mapping(answers.deployment_state_severity, DEPLOYMENT_STATES, DEFAULT_DEPLOYMENT, "answers.deployment_state_severity"),
    minimum_emit_severity: severity(answers.minimum_emit_severity ?? "low", "answers.minimum_emit_severity"),
    repeat_window_seconds: boundedInteger(answers.repeat_window_seconds ?? 900, "answers.repeat_window_seconds", 60, 86400),
    stale_after_seconds: boundedInteger(answers.stale_after_seconds ?? 3600, "answers.stale_after_seconds", 60, 604800),
    auto_resolve_on_recovery: answers.auto_resolve_on_recovery !== false,
    notify_high_and_critical: answers.notify_high_and_critical !== false,
    critical_requires_confirmation: answers.critical_requires_confirmation !== false,
    unknown_outcome_minimum_severity: "high",
    cross_tenant_projection_allowed: false,
    raw_error_message_exposed: false,
    deployment_mismatch_reconnect_required: false,
    questionnaire_provenance: {
      questionnaire_key: input.questionnaire.key,
      questionnaire_version: input.questionnaire.version,
      definition_sha256: input.questionnaire.definition_sha256,
      template_key: input.template.key,
      template_version: input.template.version,
      compiler_key: input.compiler.key,
      compiler_version: input.compiler.version,
      normalized_answers_sha256: input.normalized_answers_sha256,
    },
    secrets_included: false,
  };
  return freeze({ ...policy, policy_payload_sha256: stableGovernedPolicySha256(policy) });
}

function validatePolicy({ policy, safetyBounds }) {
  const violations = [];
  if (WEIGHT[policy.operation_status_severity.unknown_outcome] < WEIGHT.high) violations.push("unknown_outcome_below_high");
  if (policy.cross_tenant_projection_allowed !== false) violations.push("cross_tenant_projection_enabled");
  if (policy.raw_error_message_exposed !== false) violations.push("raw_error_message_exposure_enabled");
  if (policy.deployment_mismatch_reconnect_required !== false) violations.push("deployment_mismatch_reconnect_enabled");
  const maximumRepeat = Number(safetyBounds?.configurable_fields?.repeat_window_seconds?.maximum ?? 86400);
  const maximumStale = Number(safetyBounds?.configurable_fields?.stale_after_seconds?.maximum ?? 604800);
  if (policy.repeat_window_seconds > Math.min(maximumRepeat, 86400)) violations.push("repeat_window_above_bound");
  if (policy.stale_after_seconds > Math.min(maximumStale, 604800)) violations.push("stale_window_above_bound");
  return freeze({
    valid: violations.length === 0,
    violations: violations.sort(),
    operational_alerts_reused: true,
    duplicate_attention_table_created: false,
    source_authority_bounded: true,
    unknown_outcome_minimum_severity: "high",
    secrets_included: false,
  });
}

function assessRisk({ policy }) {
  const criticalMappings = [...Object.values(policy.operation_status_severity), ...Object.values(policy.deployment_state_severity)].filter((value) => value === "critical").length;
  const riskTier = criticalMappings > 0 || policy.notify_high_and_critical ? "medium" : "low";
  return freeze({
    risk_tier: riskTier,
    required_approval_class: riskTier === "medium" ? "designated_owner_approval" : "tenant_owner_confirmation",
    typed_confirmation_required: false,
    reasons: [`critical_mappings:${criticalMappings}`, `notifications_enabled:${policy.notify_high_and_critical}`],
  });
}

function buildImpactPreview({ policy }) {
  return freeze({
    affected_sources: ["activation_operation", "deployment_observation"],
    emitting_operation_statuses: Object.entries(policy.operation_status_severity).filter(([, value]) => value != null).map(([key]) => key).sort(),
    emitting_deployment_states: Object.entries(policy.deployment_state_severity).filter(([, value]) => value != null).map(([key]) => key).sort(),
    notification_behavior: {
      high_and_critical_only: policy.notify_high_and_critical,
      critical_requires_confirmation: policy.critical_requires_confirmation,
    },
    lifecycle_behavior: {
      auto_resolve_on_recovery: policy.auto_resolve_on_recovery,
      repeat_window_seconds: policy.repeat_window_seconds,
      stale_after_seconds: policy.stale_after_seconds,
    },
    storage_behavior: { authority: "operational_alerts", new_attention_table: false },
    security_impact: {
      tenant_scope_required: true,
      cross_tenant_projection_allowed: false,
      raw_error_message_exposed: false,
      source_authority_bounded: true,
    },
    rollback: { exact_prior_policy_version_required: true },
    secrets_included: false,
  });
}

export const activationOperationalAttentionPolicyAdapter = Object.freeze({
  key: "activation.operational_attention.compiler",
  version: "v1",
  compilePolicy,
  validatePolicy,
  assessRisk,
  buildImpactPreview,
});

function alertKey(parts) {
  return `alert.activation.${createHash("sha256").update(parts.join("|"), "utf8").digest("hex")}`;
}
function selectedSeverity(policy, operationStatus, deploymentState) {
  const candidates = [policy.operation_status_severity?.[operationStatus], policy.deployment_state_severity?.[deploymentState]].filter(Boolean);
  return candidates.sort((left, right) => WEIGHT[right] - WEIGHT[left])[0] ?? null;
}

export function projectActivationOperationalAttention({
  policy,
  tenantId,
  operationId,
  stageKey,
  operationStatus,
  deploymentState = "current",
  errorCode = null,
  retryable = false,
  reconciliationRequired = false,
  sourceAuthority = "activation.lifecycle",
  observedAt = new Date(),
  occurrenceCount = 1,
} = {}) {
  if (!policy || policy.policy_type !== "activation_operational_attention_policy") fail("activation_attention_policy_missing", "An exact active attention policy is required.", 409);
  const tenant = identifier(tenantId, "tenantId");
  const operation = identifier(operationId, "operationId");
  const stage = canonical(stageKey, "stageKey");
  const status = String(operationStatus ?? "").trim().toLowerCase();
  const deployment = String(deploymentState ?? "unknown").trim().toLowerCase();
  if (!OPERATION_STATUSES.includes(status)) fail("activation_attention_status_invalid", "operationStatus is unsupported.");
  if (!DEPLOYMENT_STATES.includes(deployment)) fail("activation_attention_deployment_state_invalid", "deploymentState is unsupported.");
  const authority = canonical(sourceAuthority, "sourceAuthority");
  const instant = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(instant.getTime())) fail("activation_attention_observed_at_invalid", "observedAt must be valid.");
  let resultSeverity = selectedSeverity(policy, status, deployment);
  if (status === "unknown_outcome" && WEIGHT[resultSeverity] < WEIGHT.high) resultSeverity = "high";
  if (!resultSeverity || WEIGHT[resultSeverity] < WEIGHT[policy.minimum_emit_severity]) {
    return freeze({
      should_emit: false,
      resolution_hint: policy.auto_resolve_on_recovery ? "source_recovered_or_below_threshold" : null,
      tenant_id: tenant,
      operation_id: operation,
      policy_payload_sha256: policy.policy_payload_sha256,
      secrets_included: false,
    });
  }
  const reason = errorCode == null ? `activation.${stage}.${status}` : canonical(errorCode, "errorCode");
  const fingerprint = stableGovernedPolicySha256({ tenant_id: tenant, operation_id: operation, stage_key: stage, reason_code: reason, deployment_state: deployment });
  const summary = [
    `Activation stage '${stage}' is '${status}'.`,
    deployment !== "current" ? `Deployment state is '${deployment}'.` : null,
    reconciliationRequired ? "Reconciliation is required before retry or success classification." : null,
    retryable ? "A governed retry may be available after policy checks." : null,
  ].filter(Boolean).join(" ").slice(0, 1000);
  return freeze({
    should_emit: true,
    alert_key: alertKey([tenant, operation, stage, reason, deployment]),
    fingerprint_sha256: fingerprint,
    operation_fingerprint_sha256: stableGovernedPolicySha256({ tenant_id: tenant, operation_id: operation }),
    resource_fingerprint_sha256: null,
    tenant_id: tenant,
    user_id: null,
    workspace_id: null,
    source_type: "activation_lifecycle",
    source_ref: authority,
    source_record_id: operation,
    category: "activation_operational_attention",
    severity: resultSeverity,
    title: `Activation attention: ${stage}`,
    summary,
    reason_code: reason,
    lifecycle_status: "open",
    verification_state: reconciliationRequired ? "observed" : "verified",
    evidence_type: "activation_attention_projection",
    evidence_ref: null,
    evidence: {
      operation_id: operation,
      stage_key: stage,
      operation_status: status,
      deployment_state: deployment,
      retryable: retryable === true,
      reconciliation_required: reconciliationRequired === true,
      source_authority: authority,
      policy_payload_sha256: policy.policy_payload_sha256,
      observed_at: instant.toISOString(),
      secrets_included: false,
    },
    occurrence_count: boundedInteger(occurrenceCount, "occurrenceCount", 1, 1000000),
    first_seen_at: instant.toISOString(),
    last_seen_at: instant.toISOString(),
    recommended_action_key: reconciliationRequired ? "activation.reconcile" : retryable ? "activation.retry_governed" : "activation.inspect",
    requires_confirmation: resultSeverity === "critical" && policy.critical_requires_confirmation,
    notify_eligible: policy.notify_high_and_critical && WEIGHT[resultSeverity] >= WEIGHT.high,
    execution_replay_performed: false,
    provider_dispatch_performed: false,
    reconnect_required: false,
    secrets_included: false,
  });
}

export const activationOperationalAttentionContract = Object.freeze({
  version: "activation-operational-attention-policy-adapter-v2",
  policy_type: "activation_operational_attention_policy",
  authority: "operational_alerts",
  duplicate_attention_table_created: false,
  tenant_scope_required: true,
  source_authority_bounded: true,
  unknown_outcome_minimum_severity: "high",
  reconciliation_before_retry_preserved: true,
  raw_error_message_exposed: false,
  execution_replay_performed: false,
  provider_dispatch_performed: false,
  deployment_mismatch_reconnect_required: false,
  secrets_included: false,
});
