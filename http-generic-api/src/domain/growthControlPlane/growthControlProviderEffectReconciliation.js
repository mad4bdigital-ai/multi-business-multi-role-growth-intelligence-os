import { GrowthControlPlaneError, stableSha256 } from "./growthControlPlane.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SAFE_SECRET_FLAGS = new Set(["secretsIncluded", "secrets_included"]);
const EFFECT_STATES = new Set(["applied", "not_applied", "partial", "unknown"]);
const MAX_LIST_ITEMS = 100;
const MAX_INPUT_BYTES = 262144;

function fail(code, message, field = null, issue = null, extra = {}) {
  throw new GrowthControlPlaneError(code, message, 422, field ? [{ field, issue, ...extra }] : []);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function assertBoundedJson(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch {
    fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", "Reconciliation input must be JSON-serializable.", "input", "not_json_serializable");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_INPUT_BYTES) {
    fail("GROWTH_CONTROL_RECONCILIATION_INPUT_OVERSIZED", "Reconciliation input exceeds the supported byte bound.", "input", "oversized");
  }
}

function assertSensitiveFree(value, field = "input", depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) {
      fail("GROWTH_CONTROL_RECONCILIATION_SENSITIVE_INPUT", "Reconciliation input contains a secret-like value.", field, "forbidden_sensitive_value");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key) && !(SAFE_SECRET_FLAGS.has(key) && nested === false)) {
      fail("GROWTH_CONTROL_RECONCILIATION_SENSITIVE_INPUT", "Reconciliation input contains a forbidden sensitive field.", `${field}.${key}`, "forbidden_sensitive_field");
    }
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function canonical(value, field, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  return normalized;
}

function identifier(value, field, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!ID_RE.test(normalized)) fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be a bounded opaque identifier.`, field, "invalid_identifier");
  return normalized;
}

function boundedReference(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 512 || SENSITIVE_VALUE_RE.test(normalized)) {
    fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be a bounded no-secret evidence reference.`, field, "invalid_evidence_reference");
  }
  return normalized;
}

function sha256(value, field, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(normalized)) fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be SHA-256.`, field, "invalid_sha256");
  return normalized;
}

function isoInstant(value, field) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be a valid instant.`, field, "invalid_instant");
  return parsed.toISOString();
}

function integer(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function list(values, field, normalize, required = false) {
  if (values == null) values = [];
  if (!Array.isArray(values) || values.length > MAX_LIST_ITEMS) {
    fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must be a bounded array.`, field, "invalid_or_oversized_array");
  }
  const normalized = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && normalized.length === 0) fail("GROWTH_CONTROL_RECONCILIATION_INPUT_INVALID", `${field} must not be empty.`, field, "required");
  return normalized;
}

function sameList(left, right) {
  return stableSha256(left) === stableSha256(right);
}

function missingFrom(expected, observed) {
  const observedSet = new Set(observed);
  return expected.filter((value) => !observedSet.has(value));
}

function normalizeBinding(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_RECONCILIATION_BINDING_INVALID", "receiptBinding must be an object.", "receiptBinding", "invalid_type");
  }
  return deepFreeze({
    receiptId: identifier(source.receiptId ?? source.receipt_id, "receiptBinding.receiptId"),
    planId: identifier(source.planId ?? source.plan_id, "receiptBinding.planId"),
    planStepId: identifier(source.planStepId ?? source.plan_step_id, "receiptBinding.planStepId"),
    tenantId: identifier(source.tenantId ?? source.tenant_id, "receiptBinding.tenantId"),
    operationKey: canonical(source.operationKey ?? source.operation_key, "receiptBinding.operationKey"),
    idempotencyKey: identifier(source.idempotencyKey ?? source.idempotency_key, "receiptBinding.idempotencyKey"),
    requestSha256: sha256(source.requestSha256 ?? source.request_sha256, "receiptBinding.requestSha256"),
    planHashSha256: sha256(source.planHashSha256 ?? source.plan_hash_sha256, "receiptBinding.planHashSha256"),
    nodeId: canonical(source.nodeId ?? source.node_id, "receiptBinding.nodeId"),
    capabilityKey: canonical(source.capabilityKey ?? source.capability_key, "receiptBinding.capabilityKey"),
    actionIds: list(source.actionIds ?? source.action_ids, "receiptBinding.actionIds", canonical, true),
    resourceIds: list(source.resourceIds ?? source.resource_ids, "receiptBinding.resourceIds", identifier, true),
    environment: canonical(source.environment, "receiptBinding.environment"),
    effectClass: canonical(source.effectClass ?? source.effect_class, "receiptBinding.effectClass"),
  });
}

function normalizeReadback(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_RECONCILIATION_READBACK_INVALID", "readback must be an object.", "readback", "invalid_type");
  }
  const effectState = String(source.effectState ?? source.effect_state ?? "").trim().toLowerCase();
  if (!EFFECT_STATES.has(effectState)) {
    fail("GROWTH_CONTROL_RECONCILIATION_READBACK_INVALID", "readback.effectState is unsupported.", "readback.effectState", "unsupported_effect_state");
  }
  return deepFreeze({
    contractVersion: canonical(source.contractVersion ?? source.contract_version, "readback.contractVersion"),
    effectState,
    requestSha256: sha256(source.requestSha256 ?? source.request_sha256, "readback.requestSha256"),
    planHashSha256: sha256(source.planHashSha256 ?? source.plan_hash_sha256, "readback.planHashSha256"),
    actionIds: list(source.actionIds ?? source.action_ids, "readback.actionIds", canonical, true),
    resourceIds: list(source.resourceIds ?? source.resource_ids, "readback.resourceIds", identifier, true),
    appliedActionIds: list(source.appliedActionIds ?? source.applied_action_ids, "readback.appliedActionIds", canonical),
    unappliedActionIds: list(source.unappliedActionIds ?? source.unapplied_action_ids, "readback.unappliedActionIds", canonical),
    providerOperationRef: boundedReference(source.providerOperationRef ?? source.provider_operation_ref, "readback.providerOperationRef"),
    evidenceRef: boundedReference(source.evidenceRef ?? source.evidence_ref, "readback.evidenceRef"),
    observedAt: isoInstant(source.observedAt ?? source.observed_at, "readback.observedAt"),
    providerStateSha256: sha256(source.providerStateSha256 ?? source.provider_state_sha256, "readback.providerStateSha256"),
    resultSha256: sha256(source.resultSha256 ?? source.result_sha256, "readback.resultSha256", true),
    certificationSha256: sha256(source.certificationSha256 ?? source.certification_sha256, "readback.certificationSha256"),
    readbackContractKey: canonical(source.readbackContractKey ?? source.readback_contract_key, "readback.readbackContractKey"),
    secretsIncluded: source.secretsIncluded === false || source.secrets_included === false ? false : null,
  });
}

function validateBinding(readback, binding) {
  const mismatches = [];
  if (readback.requestSha256 !== binding.requestSha256) mismatches.push("request_sha256");
  if (readback.planHashSha256 !== binding.planHashSha256) mismatches.push("plan_hash_sha256");
  if (!sameList(readback.actionIds, binding.actionIds)) mismatches.push("action_ids");
  if (!sameList(readback.resourceIds, binding.resourceIds)) mismatches.push("resource_ids");
  if (readback.secretsIncluded !== false) mismatches.push("secrets_included");
  if (mismatches.length > 0) {
    fail(
      "GROWTH_CONTROL_RECONCILIATION_BINDING_MISMATCH",
      "Readback does not match the immutable mutation receipt binding.",
      "readback",
      "binding_mismatch",
      { mismatch_fields: mismatches.sort() },
    );
  }
}

function validateEffectPartition(readback, binding) {
  const expected = binding.actionIds;
  const applied = readback.appliedActionIds;
  const unapplied = readback.unappliedActionIds;
  const overlap = applied.filter((value) => unapplied.includes(value));
  const unknownApplied = missingFrom(applied, expected);
  const unknownUnapplied = missingFrom(unapplied, expected);
  if (overlap.length || unknownApplied.length || unknownUnapplied.length) {
    fail(
      "GROWTH_CONTROL_RECONCILIATION_PARTITION_INVALID",
      "Readback action partitions overlap or reference actions outside the request.",
      "readback",
      "invalid_action_partition",
      { overlap, unknown_applied: unknownApplied, unknown_unapplied: unknownUnapplied },
    );
  }
  const partition = [...new Set([...applied, ...unapplied])].sort();
  if (readback.effectState !== "unknown" && !sameList(partition, expected)) {
    fail(
      "GROWTH_CONTROL_RECONCILIATION_PARTITION_INVALID",
      "Conclusive readback must partition every requested action.",
      "readback",
      "incomplete_action_partition",
      { missing_actions: missingFrom(expected, partition) },
    );
  }
  if (readback.effectState === "applied" && (!sameList(applied, expected) || unapplied.length !== 0 || !readback.resultSha256)) {
    fail("GROWTH_CONTROL_RECONCILIATION_STATE_INVALID", "Applied readback must confirm all actions and provide a result hash.", "readback.effectState", "applied_contract_mismatch");
  }
  if (readback.effectState === "not_applied" && (applied.length !== 0 || !sameList(unapplied, expected))) {
    fail("GROWTH_CONTROL_RECONCILIATION_STATE_INVALID", "Not-applied readback must confirm that no requested action took effect.", "readback.effectState", "not_applied_contract_mismatch");
  }
  if (readback.effectState === "partial" && (applied.length === 0 || unapplied.length === 0 || !readback.resultSha256)) {
    fail("GROWTH_CONTROL_RECONCILIATION_STATE_INVALID", "Partial readback must identify both applied and unapplied actions and provide a result hash.", "readback.effectState", "partial_contract_mismatch");
  }
}

function outcomeProjection(effectState) {
  if (effectState === "applied") {
    return {
      outcome: "confirmed_applied",
      receiptTransition: "reconciled",
      stepDisposition: "complete_from_readback",
      retryDisposition: "forbidden",
      newRequestRequired: false,
      rollbackRequired: false,
    };
  }
  if (effectState === "not_applied") {
    return {
      outcome: "confirmed_not_applied",
      receiptTransition: "reconciled",
      stepDisposition: "repair_new_request_required",
      retryDisposition: "new_request_only",
      newRequestRequired: true,
      rollbackRequired: false,
    };
  }
  if (effectState === "partial") {
    return {
      outcome: "partial_effect",
      receiptTransition: "reconciled",
      stepDisposition: "rollback_or_manual_repair_required",
      retryDisposition: "forbidden",
      newRequestRequired: false,
      rollbackRequired: true,
    };
  }
  return {
    outcome: "inconclusive",
    receiptTransition: "unknown_outcome",
    stepDisposition: "readback_required",
    retryDisposition: "forbidden",
    newRequestRequired: false,
    rollbackRequired: false,
  };
}

export function classifyGrowthControlProviderEffectReadback({ receiptBinding, readback: readbackInput } = {}) {
  assertBoundedJson({ receiptBinding, readback: readbackInput });
  assertSensitiveFree({ receiptBinding, readback: readbackInput });
  const binding = normalizeBinding(receiptBinding);
  const readback = normalizeReadback(readbackInput);
  validateBinding(readback, binding);
  validateEffectPartition(readback, binding);
  const projection = outcomeProjection(readback.effectState);
  const readbackEvidence = {
    contract_version: readback.contractVersion,
    effect_state: readback.effectState,
    request_sha256: readback.requestSha256,
    plan_hash_sha256: readback.planHashSha256,
    action_ids: readback.actionIds,
    resource_ids: readback.resourceIds,
    applied_action_ids: readback.appliedActionIds,
    unapplied_action_ids: readback.unappliedActionIds,
    provider_operation_ref: readback.providerOperationRef,
    evidence_ref: readback.evidenceRef,
    observed_at: readback.observedAt,
    provider_state_sha256: readback.providerStateSha256,
    result_sha256: readback.resultSha256,
    certification_sha256: readback.certificationSha256,
    readback_contract_key: readback.readbackContractKey,
    secrets_included: false,
  };
  const withoutHash = {
    contract_version: "growth-control-provider-effect-reconciliation-v1",
    receipt_id: binding.receiptId,
    plan_id: binding.planId,
    plan_step_id: binding.planStepId,
    tenant_id: binding.tenantId,
    operation_key: binding.operationKey,
    idempotency_key: binding.idempotencyKey,
    request_sha256: binding.requestSha256,
    plan_hash_sha256: binding.planHashSha256,
    node_id: binding.nodeId,
    capability_key: binding.capabilityKey,
    action_ids: binding.actionIds,
    resource_ids: binding.resourceIds,
    environment: binding.environment,
    effect_class: binding.effectClass,
    outcome: projection.outcome,
    receipt_transition: projection.receiptTransition,
    step_disposition: projection.stepDisposition,
    retry_disposition: projection.retryDisposition,
    new_request_required: projection.newRequestRequired,
    rollback_required: projection.rollbackRequired,
    applied_action_ids: readback.appliedActionIds,
    unapplied_action_ids: readback.unappliedActionIds,
    readback: { ...readbackEvidence, readback_sha256: stableSha256(readbackEvidence) },
    automatic_retry_allowed: false,
    automatic_rollback_allowed: false,
    execution_authorized: false,
    authority_granted: false,
    provider_call_made: false,
    provider_dispatch_performed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...withoutHash, reconciliation_sha256: stableSha256(withoutHash) });
}

export function compileGrowthControlRollbackContract({ reconciliation, compensation = {} } = {}) {
  assertBoundedJson({ reconciliation, compensation });
  assertSensitiveFree({ reconciliation, compensation });
  if (!reconciliation || reconciliation.contract_version !== "growth-control-provider-effect-reconciliation-v1") {
    fail("GROWTH_CONTROL_ROLLBACK_SOURCE_INVALID", "A canonical reconciliation decision is required.", "reconciliation", "contract_mismatch");
  }
  if (!reconciliation.reconciliation_sha256 || !SHA_RE.test(reconciliation.reconciliation_sha256)) {
    fail("GROWTH_CONTROL_ROLLBACK_SOURCE_INVALID", "Reconciliation hash is missing or invalid.", "reconciliation.reconciliation_sha256", "invalid_sha256");
  }
  if (!["partial_effect", "confirmed_applied"].includes(reconciliation.outcome)) {
    fail("GROWTH_CONTROL_ROLLBACK_NOT_APPLICABLE", "Rollback is only applicable to confirmed applied effects.", "reconciliation.outcome", "not_applicable");
  }
  const rollbackActionIds = list(compensation.rollbackActionIds ?? compensation.rollback_action_ids, "compensation.rollbackActionIds", canonical, true);
  if (!sameList(rollbackActionIds, reconciliation.applied_action_ids)) {
    fail(
      "GROWTH_CONTROL_ROLLBACK_SCOPE_MISMATCH",
      "Rollback actions must exactly cover the reconciled applied actions.",
      "compensation.rollbackActionIds",
      "action_scope_mismatch",
      { expected_action_ids: reconciliation.applied_action_ids, observed_action_ids: rollbackActionIds },
    );
  }
  const resourceIds = list(compensation.resourceIds ?? compensation.resource_ids, "compensation.resourceIds", identifier, true);
  if (!sameList(resourceIds, reconciliation.resource_ids)) {
    fail("GROWTH_CONTROL_ROLLBACK_SCOPE_MISMATCH", "Rollback resources must exactly match the reconciled resources.", "compensation.resourceIds", "resource_scope_mismatch");
  }
  const environment = canonical(compensation.environment, "compensation.environment");
  if (environment !== reconciliation.environment) {
    fail("GROWTH_CONTROL_ROLLBACK_SCOPE_MISMATCH", "Rollback environment must match the reconciled effect environment.", "compensation.environment", "environment_mismatch");
  }
  const base = {
    contract_version: "growth-control-provider-rollback-contract-v1",
    source_reconciliation_sha256: reconciliation.reconciliation_sha256,
    source_receipt_id: reconciliation.receipt_id,
    source_request_sha256: reconciliation.request_sha256,
    plan_id: reconciliation.plan_id,
    plan_step_id: reconciliation.plan_step_id,
    tenant_id: reconciliation.tenant_id,
    rollback_capability_key: canonical(compensation.rollbackCapabilityKey ?? compensation.rollback_capability_key, "compensation.rollbackCapabilityKey"),
    rollback_action_ids: rollbackActionIds,
    resource_ids: resourceIds,
    environment,
    endpoint_key: canonical(compensation.endpointKey ?? compensation.endpoint_key, "compensation.endpointKey"),
    certification_key: canonical(compensation.certificationKey ?? compensation.certification_key, "compensation.certificationKey"),
    approval_profile_key: canonical(compensation.approvalProfileKey ?? compensation.approval_profile_key, "compensation.approvalProfileKey"),
    readback_key: canonical(compensation.readbackKey ?? compensation.readback_key, "compensation.readbackKey"),
    expires_in_seconds: integer(compensation.expiresInSeconds ?? compensation.expires_in_seconds, "compensation.expiresInSeconds", 300, 86400, 3600),
    max_attempts: integer(compensation.maxAttempts ?? compensation.max_attempts, "compensation.maxAttempts", 1, 1, 1),
    approval_required: true,
    final_boundary_required: true,
    certification_required: true,
    resource_authority_required: true,
    readback_required: true,
    new_mutation_receipt_required: true,
    blind_retry_allowed: false,
    automatic_retry_allowed: false,
    automatic_rollback_allowed: false,
    execution_authorized: false,
    authority_granted: false,
    provider_call_made: false,
    provider_dispatch_performed: false,
    external_writes: false,
    secrets_included: false,
  };
  const requestHash = stableSha256(base);
  return deepFreeze({
    ...base,
    rollback_request_sha256: requestHash,
    idempotency_key: stableSha256({
      source_reconciliation_sha256: reconciliation.reconciliation_sha256,
      rollback_request_sha256: requestHash,
    }),
  });
}

export const growthControlProviderEffectReconciliationContract = Object.freeze({
  version: "growth-control-provider-effect-reconciliation-v1",
  effect_states: [...EFFECT_STATES].sort(),
  conclusive_receipt_transition: "reconciled",
  inconclusive_receipt_transition: "unknown_outcome",
  blind_retry_allowed: false,
  automatic_retry_allowed: false,
  automatic_rollback_allowed: false,
  exact_request_action_resource_binding: true,
  readback_certification_required: true,
  no_secret_evidence_required: true,
  authority_granted: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});

export const growthControlProviderRollbackContract = Object.freeze({
  version: "growth-control-provider-rollback-contract-v1",
  exact_applied_action_scope_required: true,
  separate_approval_required: true,
  final_boundary_required: true,
  certification_required: true,
  resource_authority_required: true,
  readback_required: true,
  new_mutation_receipt_required: true,
  max_attempts: 1,
  blind_retry_allowed: false,
  automatic_rollback_allowed: false,
  authority_granted: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderEffectReconciliation = Object.freeze({
  normalizeBinding,
  normalizeReadback,
  validateBinding,
  validateEffectPartition,
  outcomeProjection,
  sameList,
  missingFrom,
  assertSensitiveFree,
  deepFreeze,
});
