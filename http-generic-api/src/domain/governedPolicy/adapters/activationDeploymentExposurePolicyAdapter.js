import {
  GovernedPolicyError,
  stableGovernedPolicySha256,
} from "../governedPolicyQuestionnaireEngine.js";

const EXPOSURE_ORDER = Object.freeze({ none: 0, opaque: 1, diagnostic: 2, admin_full: 3 });
const PRINCIPAL_CEILINGS = Object.freeze({
  public: "diagnostic",
  tenant_user: "diagnostic",
  tenant_admin: "diagnostic",
  platform_admin: "admin_full",
  service: "admin_full",
});
const ALLOWED_STATES = Object.freeze(["current", "deploying", "stale", "diverged", "unknown"]);
const ALLOWED_EXPOSURES = Object.freeze(Object.keys(EXPOSURE_ORDER));
const OPERATION_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{2,190}$/;
const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const MAX_OPERATION_IDS = 100;
const MAX_FRESHNESS_SECONDS = 86_400;

function fail(code, message, status = 422, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("deployment_exposure_policy_invalid_key", `${field} must be canonical.`, 422, { field });
  return normalized;
}

function exposure(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!ALLOWED_EXPOSURES.includes(normalized)) {
    fail("deployment_exposure_policy_invalid_exposure", `${field} is unsupported.`, 422, { field });
  }
  return normalized;
}

function principal(value, field = "principal_class") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!Object.hasOwn(PRINCIPAL_CEILINGS, normalized)) {
    fail("deployment_exposure_policy_invalid_principal", `${field} is unsupported.`, 422, { field });
  }
  return normalized;
}

function boundedInteger(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("deployment_exposure_policy_out_of_bounds", `${field} is outside the supported bounds.`, 422, {
      field,
      minimum,
      maximum,
    });
  }
  return normalized;
}

function operationIds(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_OPERATION_IDS) {
    fail("deployment_exposure_policy_operations_invalid", "applicable_operation_ids must be a non-empty bounded array.", 422);
  }
  const normalized = [...new Set(values.map((value, index) => {
    const id = String(value ?? "").trim();
    if (!OPERATION_ID_RE.test(id)) {
      fail("deployment_exposure_policy_operation_invalid", `applicable_operation_ids[${index}] is invalid.`, 422, {
        field: `applicable_operation_ids[${index}]`,
      });
    }
    return id;
  }))].sort();
  return normalized;
}

function exactStateMapping(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("deployment_exposure_policy_state_mapping_invalid", "state_exposure must be an object.");
  }
  const output = {};
  for (const state of ALLOWED_STATES) {
    output[state] = exposure(source[state] ?? "opaque", `state_exposure.${state}`);
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_STATES.includes(key));
  if (unknown.length > 0) {
    fail("deployment_exposure_policy_state_mapping_invalid", "state_exposure contains unsupported states.", 422, {
      states: unknown.sort(),
    });
  }
  return Object.freeze(output);
}

function ensureWithinCeiling(level, ceiling, field) {
  if (EXPOSURE_ORDER[level] > EXPOSURE_ORDER[ceiling]) {
    fail("deployment_exposure_policy_ceiling_exceeded", `${field} exceeds the immutable principal ceiling.`, 409, {
      requested: level,
      ceiling,
      field,
    });
  }
}

function compilePolicy({ input }) {
  const answers = input.normalized_answers ?? {};
  const principalClass = principal(answers.principal_class ?? "tenant_user", "answers.principal_class");
  const immutableCeiling = PRINCIPAL_CEILINGS[principalClass];
  const maximumExposure = exposure(
    answers.maximum_exposure_level ?? immutableCeiling,
    "answers.maximum_exposure_level",
  );
  const defaultExposure = exposure(
    answers.default_exposure_level ?? "opaque",
    "answers.default_exposure_level",
  );
  ensureWithinCeiling(maximumExposure, immutableCeiling, "maximum_exposure_level");
  ensureWithinCeiling(defaultExposure, maximumExposure, "default_exposure_level");
  const stateExposure = exactStateMapping(answers.state_exposure ?? {});
  for (const [state, level] of Object.entries(stateExposure)) {
    ensureWithinCeiling(level, maximumExposure, `state_exposure.${state}`);
  }
  const policy = {
    policy_type: "deployment_evidence_exposure_policy",
    principal_class: principalClass,
    immutable_principal_ceiling: immutableCeiling,
    maximum_exposure_level: maximumExposure,
    default_exposure_level: defaultExposure,
    state_exposure: stateExposure,
    include_parameter_allowed: answers.include_parameter_allowed === true,
    freshness_window_seconds: boundedInteger(
      answers.freshness_window_seconds ?? 300,
      "answers.freshness_window_seconds",
      1,
      MAX_FRESHNESS_SECONDS,
    ),
    classification_policy_key: canonical(
      answers.classification_policy_key ?? "activation.deployment.classification.v1",
      "answers.classification_policy_key",
    ),
    public_release_id_source_key: canonical(
      answers.public_release_id_source_key ?? "activation.deployment.opaque_release_id.v1",
      "answers.public_release_id_source_key",
    ),
    header_enabled: answers.header_enabled === true,
    attention_policy_key: answers.attention_policy_key == null
      ? null
      : canonical(answers.attention_policy_key, "answers.attention_policy_key"),
    applicable_operation_ids: operationIds(
      answers.applicable_operation_ids
        ?? input.session.context_snapshot?.applicable_operation_ids
        ?? ["getActivationDeploymentStatus"],
    ),
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
    missing_invalid_or_stale_evidence_state: "unknown",
    deployment_mismatch_reconnect_required: false,
    full_git_sha_tenant_visible: false,
    secrets_included: false,
  };
  return Object.freeze({
    ...policy,
    policy_payload_sha256: stableGovernedPolicySha256(policy),
  });
}

function validatePolicy({ policy, safetyBounds }) {
  const violations = [];
  const ceiling = PRINCIPAL_CEILINGS[principal(policy.principal_class)];
  if (policy.immutable_principal_ceiling !== ceiling) violations.push("principal_ceiling_drift");
  if (EXPOSURE_ORDER[policy.maximum_exposure_level] > EXPOSURE_ORDER[ceiling]) violations.push("maximum_exposure_above_ceiling");
  if (EXPOSURE_ORDER[policy.default_exposure_level] > EXPOSURE_ORDER[policy.maximum_exposure_level]) {
    violations.push("default_exposure_above_maximum");
  }
  for (const state of ALLOWED_STATES) {
    if (!Object.hasOwn(policy.state_exposure, state)) violations.push(`missing_state:${state}`);
    else if (EXPOSURE_ORDER[policy.state_exposure[state]] > EXPOSURE_ORDER[policy.maximum_exposure_level]) {
      violations.push(`state_exposure_above_maximum:${state}`);
    }
  }
  if (policy.missing_invalid_or_stale_evidence_state !== "unknown") violations.push("unsafe_missing_evidence_classification");
  if (policy.deployment_mismatch_reconnect_required !== false) violations.push("deployment_mismatch_reconnect_guidance_enabled");
  if (policy.full_git_sha_tenant_visible !== false) violations.push("tenant_git_sha_exposure_enabled");
  const registryMaximum = Number(safetyBounds?.configurable_fields?.freshness_window_seconds?.maximum ?? MAX_FRESHNESS_SECONDS);
  if (policy.freshness_window_seconds > Math.min(registryMaximum, MAX_FRESHNESS_SECONDS)) {
    violations.push("freshness_window_above_registry_bound");
  }
  return Object.freeze({
    valid: violations.length === 0,
    violations: Object.freeze(violations.sort()),
    immutable_principal_ceiling_enforced: true,
    tenant_admin_full_allowed: false,
    arbitrary_operation_pattern_allowed: false,
    secrets_included: false,
  });
}

function assessRisk({ policy }) {
  let riskTier = "low";
  if (policy.maximum_exposure_level === "diagnostic" || policy.header_enabled) riskTier = "medium";
  if (policy.maximum_exposure_level === "admin_full") riskTier = "high";
  return Object.freeze({
    risk_tier: riskTier,
    required_approval_class: riskTier === "low"
      ? "tenant_owner_confirmation"
      : riskTier === "medium"
        ? "designated_owner_approval"
        : "platform_admin_approval",
    typed_confirmation_required: false,
    reasons: Object.freeze([
      `principal_class:${policy.principal_class}`,
      `maximum_exposure:${policy.maximum_exposure_level}`,
      `header_enabled:${policy.header_enabled}`,
    ]),
  });
}

function buildImpactPreview({ policy }) {
  return Object.freeze({
    affected_operations: Object.freeze([...policy.applicable_operation_ids]),
    affected_principal_class: policy.principal_class,
    tenant_exposure_ceiling: PRINCIPAL_CEILINGS[policy.principal_class],
    default_exposure_level: policy.default_exposure_level,
    maximum_exposure_level: policy.maximum_exposure_level,
    header_channel_enabled: policy.header_enabled,
    include_parameter_allowed: policy.include_parameter_allowed,
    freshness_window_seconds: policy.freshness_window_seconds,
    security_impact: Object.freeze({
      full_git_sha_tenant_visible: false,
      branch_repository_host_path_visible_to_tenant: false,
      credentials_or_topology_visible_to_tenant: false,
      immutable_principal_ceiling: true,
    }),
    compatibility_impact: Object.freeze({
      response_shape_remains_bounded: true,
      header_optional: true,
      reconnect_guidance_changed: false,
    }),
    rollout: Object.freeze({ strategy: "registry_versioned", critical_cache_invalidation: true }),
    rollback: Object.freeze({ exact_prior_policy_version_required: true }),
    unknown_or_unmeasured_claims: Object.freeze([]),
    secrets_included: false,
  });
}

export const activationDeploymentExposurePolicyAdapter = Object.freeze({
  key: "activation.deployment_exposure.compiler",
  version: "v1",
  compilePolicy,
  validatePolicy,
  assessRisk,
  buildImpactPreview,
});

export function resolveActivationDeploymentExposure({
  policy,
  principalClass,
  operationId,
  deploymentState,
  includeRequested = false,
} = {}) {
  if (!policy || policy.policy_type !== "deployment_evidence_exposure_policy") {
    fail("deployment_exposure_policy_missing", "An exact active deployment exposure policy is required.", 409);
  }
  const principalKey = principal(principalClass, "principalClass");
  if (principalKey !== policy.principal_class) {
    fail("deployment_exposure_policy_principal_mismatch", "Policy principal class does not match the verified principal.", 403);
  }
  const normalizedOperationId = String(operationId ?? "").trim();
  if (!OPERATION_ID_RE.test(normalizedOperationId) || !policy.applicable_operation_ids.includes(normalizedOperationId)) {
    fail("deployment_exposure_policy_not_applicable", "Policy is not applicable to the registered operation identity.", 403);
  }
  const state = String(deploymentState ?? "unknown").trim().toLowerCase();
  if (!ALLOWED_STATES.includes(state)) fail("deployment_exposure_policy_state_invalid", "Deployment state is unsupported.");
  let resolved = policy.state_exposure?.[state] ?? policy.default_exposure_level;
  if (includeRequested && policy.include_parameter_allowed) resolved = policy.maximum_exposure_level;
  const immutableCeiling = PRINCIPAL_CEILINGS[principalKey];
  ensureWithinCeiling(resolved, immutableCeiling, "resolved_exposure_level");
  ensureWithinCeiling(resolved, policy.maximum_exposure_level, "resolved_exposure_level");
  return Object.freeze({
    exposure_level: resolved,
    principal_class: principalKey,
    operation_id: normalizedOperationId,
    deployment_state: state,
    header_enabled: policy.header_enabled === true,
    freshness_window_seconds: policy.freshness_window_seconds,
    policy_payload_sha256: policy.policy_payload_sha256,
    reconnect_required: false,
    secrets_included: false,
  });
}

export const activationDeploymentExposurePolicyContract = Object.freeze({
  version: "activation-deployment-exposure-policy-adapter-v1",
  policy_type: "deployment_evidence_exposure_policy",
  tenant_and_public_ceiling: "diagnostic",
  platform_admin_and_service_ceiling: "admin_full",
  arbitrary_caller_patterns_allowed: false,
  exact_registered_operation_applicability: true,
  missing_or_invalid_policy_fails_closed: true,
  missing_or_stale_evidence_state: "unknown",
  deployment_mismatch_reconnect_required: false,
  exact_registry_readback_required: true,
  critical_cache_invalidation_required: true,
  secrets_included: false,
});
