import assert from "node:assert/strict";
import {
  GovernedPolicyError,
  normalizeQuestionnaireDefinition,
  createPinnedQuestionnaireSession,
  selectGovernedPolicyQuestions,
  validateQuestionnaireAnswers,
  compileGovernedPolicyProposal,
  stableGovernedPolicySha256,
  governedPolicyQuestionnaireEngineContract,
} from "./src/domain/governedPolicy/governedPolicyQuestionnaireEngine.js";
import {
  activationDeploymentExposurePolicyAdapter,
  resolveActivationDeploymentExposure,
  activationDeploymentExposurePolicyContract,
} from "./src/domain/governedPolicy/adapters/activationDeploymentExposurePolicyAdapter.js";
import {
  activationOperationalAttentionPolicyAdapter,
  projectActivationOperationalAttention,
  activationOperationalAttentionContract,
} from "./src/domain/governedPolicy/adapters/activationOperationalAttentionPolicyAdapter.js";

const now = new Date();
const definition = normalizeQuestionnaireDefinition({
  questionnaire_key: "activation.deployment_exposure.questionnaire",
  version: "v1",
  domain_key: "activation",
  purpose_key: "deployment_exposure",
  applicable_actor_roles: ["tenant_owner", "platform_admin"],
  interaction_modes: ["guided", "expert_governed"],
  policy_template_key: "activation.deployment_exposure.template",
  policy_template_version: "v1",
  compiler_key: "activation.deployment_exposure.compiler",
  compiler_version: "v1",
  impact_model_key: "activation.deployment_exposure.impact",
  impact_model_version: "v1",
  approval_policy_key: "activation.deployment_exposure.approval",
  approval_policy_version: "v1",
  status: "active",
  effective_at: new Date(now.getTime() - 60_000).toISOString(),
  questions: [
    { question_key: "principal_class", answer_type: "enum", allowed_values: ["tenant_user", "platform_admin"], constraints: {}, required: true },
    { question_key: "maximum_exposure_level", answer_type: "enum", allowed_values: ["none", "opaque", "diagnostic", "admin_full"], constraints: {}, required: true },
    { question_key: "default_exposure_level", answer_type: "enum", allowed_values: ["none", "opaque", "diagnostic", "admin_full"], constraints: {}, required: true },
    { question_key: "state_exposure", answer_type: "object", constraints: { maximum_bytes: 4096 }, required: true },
    { question_key: "include_parameter_allowed", answer_type: "boolean", constraints: {}, required: true },
    { question_key: "freshness_window_seconds", answer_type: "integer", constraints: { minimum: 1, maximum: 86400 }, required: true },
    { question_key: "header_enabled", answer_type: "boolean", constraints: {}, required: true },
    {
      question_key: "applicable_operation_ids",
      answer_type: "multi_select",
      allowed_values: ["getActivationDeploymentStatus", "readTenantActivationOperation"],
      constraints: { minimum_items: 1, maximum_items: 10 },
      required: true,
    },
    {
      question_key: "admin_reason",
      answer_type: "string",
      constraints: { minimum_length: 3, maximum_length: 200 },
      required: true,
      visibility_rule: {
        mode: "all",
        conditions: [{ source: "answer", key: "principal_class", operator: "equals", value: "platform_admin" }],
      },
      dependency_questions: ["principal_class"],
    },
  ],
});
assert.match(definition.definition_sha256, /^[a-f0-9]{64}$/);
assert.equal(governedPolicyQuestionnaireEngineContract.questionnaire_is_runtime_authority, false);

const session = createPinnedQuestionnaireSession({
  definition,
  tenantId: "tenant-001",
  userId: "user-001",
  actorRoles: ["tenant_owner"],
  interactionMode: "guided",
  context: { applicable_operation_ids: ["getActivationDeploymentStatus"] },
  now,
});
assert.equal(session.questionnaire_version, "v1");
assert.equal(session.definition_sha256, definition.definition_sha256);
assert.ok(Object.isFrozen(session));

const answers = {
  principal_class: "tenant_user",
  maximum_exposure_level: "diagnostic",
  default_exposure_level: "opaque",
  state_exposure: {
    current: "opaque",
    deploying: "opaque",
    stale: "diagnostic",
    diverged: "diagnostic",
    unknown: "opaque",
  },
  include_parameter_allowed: true,
  freshness_window_seconds: 300,
  header_enabled: true,
  applicable_operation_ids: ["getActivationDeploymentStatus"],
};
const visible = selectGovernedPolicyQuestions({
  definition,
  answers,
  context: session.context_snapshot,
  actorRoles: session.actor_roles,
  interactionMode: session.interaction_mode,
});
assert.equal(visible.some((question) => question.question_key === "admin_reason"), false);
const evidence = validateQuestionnaireAnswers({ session, definition, answers });
assert.match(evidence.normalized_answers_sha256, /^[a-f0-9]{64}$/);

const safetyBounds = {
  safety_bounds_key: "activation.deployment_exposure.bounds",
  version: "v1",
  domain_key: "activation",
  immutable_rules: ["tenant_isolation", "no_secret_handling", "tenant_admin_full_forbidden"],
  configurable_fields: { freshness_window_seconds: { minimum: 1, maximum: 3600 } },
  risk_matrix: {},
  status: "active",
};
const compile = (proposalId) => compileGovernedPolicyProposal({
  session,
  definition,
  answers,
  safetyBounds,
  adapter: activationDeploymentExposurePolicyAdapter,
  resourceUri: "urn:mad4b:tenant:tenant-001:deployment-exposure",
  proposedVersion: "v1",
  proposalId,
  now,
});
const first = compile("proposal-001");
const second = compile("proposal-002");
assert.equal(first.compilation.compiled_policy_sha256, second.compilation.compiled_policy_sha256);
assert.equal(first.compilation.normalized_input_sha256, second.compilation.normalized_input_sha256);
assert.notEqual(first.proposal.proposal_id, second.proposal.proposal_id);
assert.notEqual(first.proposal.proposal_hash_sha256, second.proposal.proposal_hash_sha256);
assert.equal(first.compilation.compiled_policy.maximum_exposure_level, "diagnostic");
assert.equal(first.compilation.compiled_policy.full_git_sha_tenant_visible, false);
assert.equal(first.compilation.safety_validation.valid, true);

const resolved = resolveActivationDeploymentExposure({
  policy: first.compilation.compiled_policy,
  principalClass: "tenant_user",
  operationId: "getActivationDeploymentStatus",
  deploymentState: "diverged",
  includeRequested: true,
});
assert.equal(resolved.exposure_level, "diagnostic");
assert.equal(resolved.reconnect_required, false);
assert.equal(activationDeploymentExposurePolicyContract.tenant_and_public_ceiling, "diagnostic");

assert.throws(
  () => compileGovernedPolicyProposal({
    session,
    definition,
    answers: { ...answers, maximum_exposure_level: "admin_full" },
    safetyBounds,
    adapter: activationDeploymentExposurePolicyAdapter,
    resourceUri: "urn:mad4b:tenant:tenant-001:deployment-exposure",
    proposedVersion: "v2",
    now,
  }),
  (error) => error instanceof GovernedPolicyError && error.code === "deployment_exposure_policy_ceiling_exceeded",
);
assert.throws(
  () => createPinnedQuestionnaireSession({
    definition,
    tenantId: "tenant-001",
    userId: "user-001",
    actorRoles: ["tenant_owner"],
    context: { api_token: "Bearer forbidden" },
    now,
  }),
  (error) => error instanceof GovernedPolicyError && /sensitive/.test(error.code),
);

const attentionInput = {
  questionnaire: { key: "activation.attention.questionnaire", version: "v1", definition_sha256: "a".repeat(64) },
  template: { key: "activation.attention.template", version: "v1" },
  compiler: { key: "activation.operational_attention.compiler", version: "v1" },
  normalized_answers_sha256: "b".repeat(64),
  normalized_answers: {
    minimum_emit_severity: "low",
    repeat_window_seconds: 900,
    stale_after_seconds: 3600,
    auto_resolve_on_recovery: true,
    notify_high_and_critical: true,
    critical_requires_confirmation: true,
    operation_status_severity: { failed: "critical", unknown_outcome: "high" },
    deployment_state_severity: { stale: "medium", diverged: "high", unknown: "medium" },
  },
};
const attentionPolicy = activationOperationalAttentionPolicyAdapter.compilePolicy({ input: attentionInput });
assert.equal(activationOperationalAttentionPolicyAdapter.validatePolicy({
  policy: attentionPolicy,
  safetyBounds: {
    configurable_fields: {
      repeat_window_seconds: { maximum: 86400 },
      stale_after_seconds: { maximum: 604800 },
    },
  },
}).valid, true);
const attention = projectActivationOperationalAttention({
  policy: attentionPolicy,
  tenantId: "tenant-001",
  operationId: "operation-001",
  stageKey: "dispatch_execute",
  operationStatus: "unknown_outcome",
  deploymentState: "stale",
  errorCode: "activation.dispatch.unknown_outcome",
  retryable: true,
  reconciliationRequired: true,
  observedAt: now,
});
assert.equal(attention.should_emit, true);
assert.equal(attention.severity, "high");
assert.equal(attention.recommended_action_key, "activation.reconcile");
assert.equal(attention.execution_replay_performed, false);
assert.equal(attention.reconnect_required, false);
assert.equal(activationOperationalAttentionContract.authority, "operational_alerts");
const recovered = projectActivationOperationalAttention({
  policy: attentionPolicy,
  tenantId: "tenant-001",
  operationId: "operation-001",
  stageKey: "deployment_verify",
  operationStatus: "active",
  deploymentState: "current",
  observedAt: now,
});
assert.equal(recovered.should_emit, false);
assert.equal(recovered.resolution_hint, "source_recovered_or_below_threshold");
assert.notEqual(stableGovernedPolicySha256({ a: 1 }), stableGovernedPolicySha256({ a: 2 }));
console.log("governed policy questionnaire domain tests passed");
