const RISK_RANK = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

export const EFFECT_CLASSES = Object.freeze([
  "read_only",
  "internal_write",
  "external_write",
  "destructive_write",
  "commercial_effect",
]);

export const APPROVAL_CONTRACTS = Object.freeze([
  "none",
  "policy_resolved",
  "explicit",
  "typed_confirmation",
]);

export const READBACK_CONTRACTS = Object.freeze([
  "none",
  "same_cycle_required",
  "provider_verified",
]);

export const RISK_CLASSES = Object.freeze(["low", "medium", "high", "critical"]);

const EFFECT_MINIMUMS = Object.freeze({
  read_only: "low",
  internal_write: "medium",
  external_write: "high",
  destructive_write: "critical",
  commercial_effect: "high",
});

const EFFECT_APPROVAL_MINIMUMS = Object.freeze({
  read_only: "none",
  internal_write: "policy_resolved",
  external_write: "explicit",
  destructive_write: "typed_confirmation",
  commercial_effect: "explicit",
});

const LEVEL_ORDER = Object.freeze({ none: 0, policy_resolved: 1, explicit: 2, typed_confirmation: 3 });

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function lower(value, max = 2048) {
  return text(value, max).toLowerCase();
}

function minimumRisk(a, b) {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function minimumApproval(a, b) {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

function approvalRequired(approvalContract) {
  return approvalContract !== "none";
}

function effectMinimumReadback(effectClass) {
  return effectClass === "external_write" || effectClass === "destructive_write" || effectClass === "commercial_effect"
    ? "provider_verified"
    : effectClass === "internal_write" ? "same_cycle_required" : "none";
}

export function canonicalBrandCreateOperation() {
  return Object.freeze({
    operation_key: "brand.create",
    resource_type: "brand",
    effect_class: "internal_write",
    risk_class: "medium",
    approval_contract: "policy_resolved",
    readback_contract: "same_cycle_required",
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    expected_revision_required: false,
    idempotency_required: true,
    authority_required: true,
    executor_ref: "workspaceBrandRootTopology.createWorkspaceBrandWithRootTopology",
    tool_discovery_required: false,
  });
}

export function validateOperationDescriptor(descriptor = {}) {
  const errors = [];
  const operationKey = lower(descriptor.operation_key, 128);
  const resourceType = lower(descriptor.resource_type, 64);
  const effectClass = lower(descriptor.effect_class, 64);
  const riskClass = lower(descriptor.risk_class, 32);
  const approvalContract = lower(descriptor.approval_contract, 32);
  const readbackContract = lower(descriptor.readback_contract, 32);
  if (!operationKey) errors.push("operation_key_required");
  if (!resourceType) errors.push("resource_type_required");
  if (!EFFECT_CLASSES.includes(effectClass)) errors.push("effect_class_invalid");
  if (!RISK_CLASSES.includes(riskClass)) errors.push("risk_class_invalid");
  if (!APPROVAL_CONTRACTS.includes(approvalContract)) errors.push("approval_contract_invalid");
  if (!READBACK_CONTRACTS.includes(readbackContract)) errors.push("readback_contract_invalid");
  if (EFFECT_CLASSES.includes(effectClass) && RISK_CLASSES.includes(riskClass) && RISK_RANK[riskClass] < RISK_RANK[EFFECT_MINIMUMS[effectClass]]) {
    errors.push("risk_below_effect_floor");
  }
  if (EFFECT_CLASSES.includes(effectClass) && APPROVAL_CONTRACTS.includes(approvalContract) && LEVEL_ORDER[approvalContract] < LEVEL_ORDER[EFFECT_APPROVAL_MINIMUMS[effectClass]]) {
    errors.push("approval_below_effect_floor");
  }
  if (EFFECT_CLASSES.includes(effectClass) && READBACK_CONTRACTS.includes(readbackContract) && READBACK_CONTRACTS.indexOf(readbackContract) < READBACK_CONTRACTS.indexOf(effectMinimumReadback(effectClass))) {
    errors.push("readback_below_effect_floor");
  }
  if (descriptor.authority_required !== true) errors.push("authority_required");
  if (descriptor.idempotency_required !== true && effectClass !== "read_only") errors.push("idempotency_required_for_effect");
  if (descriptor.tool_discovery_required === true && operationKey === "brand.create") errors.push("known_brand_create_must_not_discover_tools");
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? Object.freeze({
      operation_key: operationKey,
      resource_type: resourceType,
      effect_class: effectClass,
      risk_class: riskClass,
      approval_contract: approvalContract,
      readback_contract: readbackContract,
      identity_resolution_contract: text(descriptor.identity_resolution_contract, 128) || null,
      relationship_resolution_contract: text(descriptor.relationship_resolution_contract, 128) || null,
      expected_revision_required: descriptor.expected_revision_required === true,
      idempotency_required: descriptor.idempotency_required === true,
      authority_required: true,
      tool_discovery_required: descriptor.tool_discovery_required === true,
      executor_ref: text(descriptor.executor_ref, 255) || null,
    }) : null,
  });
}

export function resolveOperationGovernance({ descriptor, policy = {}, caller = {} } = {}) {
  const descriptorResult = validateOperationDescriptor(descriptor);
  if (!descriptorResult.valid) {
    return Object.freeze({ status: "blocked", reason_codes: descriptorResult.errors, descriptor: null });
  }
  const canonical = descriptorResult.normalized;
  const requestedFloor = RISK_CLASSES.includes(lower(policy.minimum_risk, 32)) ? lower(policy.minimum_risk, 32) : "low";
  const requiredFloor = APPROVAL_CONTRACTS.includes(lower(policy.approval_contract, 32)) ? lower(policy.approval_contract, 32) : "none";
  const effectiveRisk = minimumRisk(canonical.risk_class, requestedFloor);
  const effectiveApproval = minimumApproval(canonical.approval_contract, requiredFloor);
  const callerRisk = lower(caller.risk_class, 32);
  const callerApproval = lower(caller.approval_contract, 32);
  const callerAttemptedLowering = (RISK_CLASSES.includes(callerRisk) && RISK_RANK[callerRisk] < RISK_RANK[effectiveRisk])
    || (APPROVAL_CONTRACTS.includes(callerApproval) && LEVEL_ORDER[callerApproval] < LEVEL_ORDER[effectiveApproval]);
  return Object.freeze({
    status: "ready",
    operation_key: canonical.operation_key,
    resource_type: canonical.resource_type,
    effect_class: canonical.effect_class,
    risk_class: effectiveRisk,
    approval_contract: effectiveApproval,
    approval_required: approvalRequired(effectiveApproval),
    readback_contract: canonical.readback_contract,
    identity_resolution_contract: canonical.identity_resolution_contract,
    relationship_resolution_contract: canonical.relationship_resolution_contract,
    caller_attempted_lowering: callerAttemptedLowering,
    tool_discovery_required: canonical.tool_discovery_required,
    authority_required: canonical.authority_required,
    idempotency_required: canonical.idempotency_required,
  });
}

export function conservativeFallbackOperationInference(operationKey = "") {
  const key = lower(operationKey, 128);
  const mutationLike = /(^|[._-])(create|update|write|apply|mutate|publish|delete|archive|restore)([._-]|$)/.test(key);
  return Object.freeze({
    source: "compatibility_text_fallback",
    operation_key: key,
    risk_class: mutationLike ? "high" : "low",
    approval_required: mutationLike,
    dispatch_allowed: !mutationLike,
  });
}

export const _testingPlatformOperationGovernance = Object.freeze({ RISK_RANK, LEVEL_ORDER, minimumRisk, minimumApproval });
