import assert from "node:assert/strict";
import {
  SPEC011_GOAL_FILTERED_INTELLIGENCE_VERSION,
  buildGoalFilteredOperationalIntelligence,
  classifyGoalAttention,
  correlateGoalToOperations,
} from "./spec011GoalFilteredOperationalIntelligence.js";

const GOAL = {
  goal_id: "goal-phase8",
  title: "Deliver governed repository change",
  intent: "Complete a managed repository delivery safely.",
  operation_keys: ["repo.change.execute"],
  resource_refs: ["github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"],
  container_keys: ["workspace:w1"],
  tenant_id: "tenant-1",
  workspace_id: "w1",
  brand_keys: ["brand-a"],
  system_ids: ["github-system"],
  tags: ["managed-delivery"],
};

const OPERATIONS = [
  {
    operation_id: "op-primary",
    operation_key: "repo.change.execute",
    status: "blocked",
    goal_refs: ["goal-phase8"],
    resource_refs: ["github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"],
    container_keys: ["workspace:w1"],
    tenant_id: "tenant-1",
    workspace_id: "w1",
    blockers: ["required_ci_failed"],
    next_action: { action_key: "repo.ci.diagnose" },
    evidence_refs: ["evidence://operation/op-primary"],
  },
  {
    operation_id: "op-resource",
    operation_key: "repo.branch.reconcile",
    status: "running",
    resource_refs: ["github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"],
    tenant_id: "tenant-1",
    workspace_id: "w1",
    next_action: "wait_for_branch_readback",
  },
  {
    operation_id: "op-child",
    operation_key: "operation.resume",
    status: "queued",
    parent_operation_id: "op-primary",
    tenant_id: "tenant-1",
  },
  {
    operation_id: "op-semantic-pair",
    operation_key: "repo.change.execute",
    status: "awaiting_approval",
    tenant_id: "tenant-1",
    tags: ["managed-delivery"],
  },
  {
    operation_id: "op-tenant-only",
    operation_key: "unrelated.operation",
    status: "completed",
    tenant_id: "tenant-1",
  },
];

const ATTENTION = [
  {
    queue_key: "attention-ci",
    severity: "high",
    source: "ci",
    reason_code: "required_ci_failed",
    title: "Required CI failed",
    operation_refs: ["op-primary"],
    recommended_action_key: "repo.ci.diagnose",
    requires_confirmation: false,
    evidence: { operation_id: "op-primary", source_ref: "evidence://attention/ci" },
  },
  {
    queue_key: "attention-resource",
    severity: "medium",
    source: "repository",
    reason_code: "latency_warning",
    title: "Repository readback is slower than normal",
    container_key: "workspace:w1",
    recommended_action_key: "repository.readback.inspect",
    evidence: { container_key: "workspace:w1", source_ref: "evidence://attention/resource" },
  },
  {
    queue_key: "attention-platform",
    severity: "high",
    source: "platform",
    reason_code: "platform_capacity_pressure",
    title: "Platform capacity is under pressure",
    scope: "platform",
    platform_wide: true,
    evidence: { scope: "platform", source_ref: "evidence://attention/platform" },
  },
  {
    queue_key: "attention-unrelated",
    severity: "high",
    source: "connector",
    reason_code: "connector_error",
    title: "Unrelated connector is in error state",
    container_key: "workspace:other",
    tenant_id: "tenant-other",
    evidence: { container_key: "workspace:other", tenant_id: "tenant-other", source_ref: "evidence://attention/unrelated" },
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    queue_key: `attention-related-${index}`,
    severity: "low",
    source: "repository",
    reason_code: "related_observation",
    title: `Related repository observation ${index}`,
    resource_ref: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    evidence: {
      resource_ref: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      source_ref: `evidence://attention/related-${index}`,
    },
  })),
];

const correlation = correlateGoalToOperations(GOAL, OPERATIONS);
assert.equal(correlation.goal_state, "blocked");
assert.equal(correlation.summary.total_operations, 5);
assert.equal(correlation.summary.linked_operations, 4);
assert.equal(correlation.summary.primary_operations, 1);
assert.equal(correlation.summary.supporting_operations, 3);
assert.equal(correlation.summary.unrelated_operations, 1);
assert(correlation.linked_operations.some((entry) => entry.operation.operation_id === "op-child"
  && entry.correlation_reasons.includes("parent_operation_link")));
assert(correlation.linked_operations.some((entry) => entry.operation.operation_id === "op-semantic-pair"
  && entry.correlation_reasons.includes("operation_key_match")
  && entry.correlation_reasons.includes("tag_match")));
assert.equal(correlation.unrelated_operations[0].operation_id, "op-tenant-only");

const classified = classifyGoalAttention(GOAL, correlation, ATTENTION);
assert.equal(classified.counts.blocking, 1);
assert.equal(classified.counts.related_risk, 6);
assert.equal(classified.counts.platform_wide, 1);
assert.equal(classified.counts.unrelated, 1);
assert.equal(classified.buckets.blocking[0].attention.attention_id, "attention-ci");
assert.equal(classified.buckets.platform_wide[0].goal_impact, "potential");
assert.equal(classified.buckets.unrelated[0].goal_impact, "none");

const registeredPayloads = [];
const registerDiagnosticReference = async (descriptor) => {
  registeredPayloads.push(descriptor);
  return {
    reference: `diagnostic://goal-phase8/${descriptor.kind}/${descriptor.item_id}`,
    read_tool_key: "governed_diagnostic_reference_read",
    digest_sha256: descriptor.digest_sha256,
    secrets_included: false,
  };
};

const projection = await buildGoalFilteredOperationalIntelligence({
  goal: GOAL,
  operations: OPERATIONS,
  operational_intelligence: {
    ok: true,
    activation_layer: "activation_operational_intelligence",
    source_authority: "subject_scoped_operational_rows",
    attention_queue: ATTENTION,
    degraded_surfaces: [],
    secrets_included: false,
  },
  limits: {
    blocking: 1,
    related_risk: 2,
    platform_wide: 1,
    linked_operations: 2,
    blockers: 3,
    next_actions: 3,
  },
}, { registerDiagnosticReference });

assert.equal(projection.version, SPEC011_GOAL_FILTERED_INTELLIGENCE_VERSION);
assert.equal(projection.goal.state, "blocked");
assert.equal(projection.summary.inline_linked_operations, 2);
assert.equal(projection.summary.inline_attention, 4);
assert.equal(projection.summary.full_diagnostic_operation_count, 5);
assert.equal(projection.summary.full_diagnostic_attention_count, 9);
assert.equal(projection.attention.blocking.length, 1);
assert.equal(projection.attention.related_risk.length, 2);
assert.equal(projection.attention.platform_wide.length, 1);
assert.equal(projection.detail_references.unrelated_operations.length, 1);
assert.equal(projection.detail_references.unrelated_attention.length, 1);
assert.equal(projection.completeness.summary_first, true);
assert.equal(projection.completeness.full_diagnostic_detail_inline, false);
assert.equal(projection.completeness.every_operation_has_governed_reference, true);
assert.equal(projection.completeness.every_attention_item_has_governed_reference, true);
assert.equal(projection.completeness.unrelated_items_counted_not_discarded, true);
assert.equal(projection.completeness.complete, true);
assert.equal(projection.policy.exact_correlation_only, true);
assert.equal(projection.policy.tenant_only_match_is_insufficient, true);
assert.equal(projection.policy.unrelated_attention_not_inlined, true);
assert.equal(projection.policy.provider_calls_made, false);
assert.equal(projection.policy.external_mutations_executed, false);
assert.equal(projection.secrets_included, false);
assert.match(projection.projection_fingerprint_sha256, /^[0-9a-f]{64}$/);
assert.equal(registeredPayloads.length, OPERATIONS.length + ATTENTION.length);
assert(registeredPayloads.every((entry) => entry.payload && entry.digest_sha256 && entry.secrets_included === false));

for (const inlineOperation of projection.linked_operations) {
  assert.equal("raw" in inlineOperation, false);
  assert.equal("payload" in inlineOperation, false);
  assert.match(inlineOperation.diagnostic_ref.reference, /^diagnostic:\/\//);
}
for (const bucket of Object.values(projection.attention)) {
  for (const inlineAttention of bucket) {
    assert.equal("raw" in inlineAttention, false);
    assert.equal("evidence" in inlineAttention, false);
    assert.match(inlineAttention.diagnostic_ref.reference, /^diagnostic:\/\//);
  }
}

const dependencyProjection = await buildGoalFilteredOperationalIntelligence({ goal: GOAL }, {
  readOperations: async ({ goal }) => {
    assert.equal(goal.goal_id, GOAL.goal_id);
    return OPERATIONS;
  },
  buildOperationalIntelligence: async () => ({
    ok: false,
    activation_layer: "activation_operational_intelligence",
    source_authority: "degraded_test_source",
    attention_queue: ATTENTION.slice(0, 2),
    degraded_surfaces: [{ surface: "activation_signal_inbox", error: { code: "test_degraded" } }],
    secrets_included: false,
  }),
  registerDiagnosticReference,
});
assert.equal(dependencyProjection.source_health.activation_operational_intelligence_ok, false);
assert.equal(dependencyProjection.summary.degraded_operational_surface_count, 1);
assert.equal(dependencyProjection.source_health.degraded_surfaces[0].surface, "activation_signal_inbox");
assert.equal(dependencyProjection.source_health.degraded_surfaces[0].diagnostic_ref_required, true);

await assert.rejects(
  () => buildGoalFilteredOperationalIntelligence({
    goal: GOAL,
    operations: OPERATIONS,
    operational_intelligence: { ok: true, attention_queue: [], degraded_surfaces: [], secrets_included: false },
  }, {}),
  (error) => error?.code === "GOAL_DIAGNOSTIC_REGISTRAR_REQUIRED",
);

await assert.rejects(
  () => buildGoalFilteredOperationalIntelligence({
    goal: GOAL,
    operations: OPERATIONS,
    operational_intelligence: { ok: true, attention_queue: [], degraded_surfaces: [], secrets_included: false },
  }, {
    registerDiagnosticReference: async (descriptor) => ({
      reference: `diagnostic://goal-phase8/${descriptor.item_id}`,
      read_tool_key: "governed_diagnostic_reference_read",
      digest_sha256: "f".repeat(64),
      secrets_included: false,
    }),
  }),
  (error) => error?.code === "GOAL_DIAGNOSTIC_REFERENCE_INVALID",
);

assert.throws(
  () => correlateGoalToOperations({ goal_id: "empty-goal", title: "No anchors" }, []),
  (error) => error?.code === "GOAL_CORRELATION_ANCHOR_REQUIRED",
);
assert.throws(
  () => correlateGoalToOperations({ ...GOAL, api_key: "not-allowed" }, OPERATIONS),
  (error) => error?.code === "GOAL_INTELLIGENCE_SECRET_FIELD_REJECTED",
);
assert.throws(
  () => classifyGoalAttention(GOAL, correlation, [{
    queue_key: "unsafe",
    reason_code: "unsafe",
    title: "unsafe",
    evidence: { authorization: "Bearer forbidden" },
  }]),
  (error) => error?.code === "GOAL_INTELLIGENCE_SECRET_FIELD_REJECTED",
);

const noOperationProjection = await buildGoalFilteredOperationalIntelligence({
  goal: GOAL,
  operations: [],
  operational_intelligence: {
    ok: true,
    activation_layer: "activation_operational_intelligence",
    attention_queue: [ATTENTION[2]],
    degraded_surfaces: [],
    secrets_included: false,
  },
}, { registerDiagnosticReference });
assert.equal(noOperationProjection.goal.state, "not_started");
assert.equal(noOperationProjection.summary.linked_operations, 0);
assert.equal(noOperationProjection.summary.attention_by_class.platform_wide, 1);
assert.equal(noOperationProjection.completeness.complete, true);

console.log("Spec 011 goal-filtered operational intelligence tests passed");
