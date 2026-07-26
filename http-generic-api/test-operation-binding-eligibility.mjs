import assert from "node:assert/strict";
import { OperationBindingEligibilityError, evaluateOperationBindingHardConstraints, filterOperationBindingEligibility } from "./operationBindingEligibility.js";

const HASH_A = "a".repeat(64);
function candidate(overrides = {}) {
  return {
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.platform.generic",
    binding_scope_type: "platform",
    scope_ref: null,
    provider_family: null,
    capability_key: "repository_read",
    effect_class: "repository_read",
    status: "active",
    valid_from: "2026-07-01T00:00:00Z",
    valid_until: "2026-08-01T00:00:00Z",
    revision_hash: HASH_A,
    denied: false,
    deny_reasons: [],
    dispatch_allowed: true,
    endpoint_export_ready: true,
    capability_available: true,
    resource_authorized: true,
    credential_ready: true,
    adapter_healthy: true,
    capacity_available: true,
    effect_allowed: true,
    requires_approval: false,
    approval_ready: true,
    requires_readback: true,
    readback_ready: true,
    metrics: { quality: 0, reliability: 0, preference_match: 0 },
    ...overrides,
  };
}
function context(overrides = {}) {
  return {
    compile_mode: "shadow",
    now: "2026-07-26T04:00:00Z",
    resource_ref: "github://owner/repo",
    workspace_id: "workspace-1",
    tenant_id: "tenant-1",
    provider_family: "github",
    required_capability_key: "repository_read",
    expected_effect_class: "repository_read",
    ...overrides,
  };
}
{
  const resource = candidate({ binding_id: "22222222-2222-4222-8222-222222222222", binding_key: "binding.resource.github", binding_scope_type: "resource", scope_ref: "github://owner/repo", provider_family: "github" });
  const workspace = candidate({ binding_id: "33333333-3333-4333-8333-333333333333", binding_key: "binding.workspace.github", binding_scope_type: "workspace", scope_ref: "workspace-1", provider_family: "github" });
  const forward = filterOperationBindingEligibility({ candidates: [workspace, resource], context: context() });
  const reverse = filterOperationBindingEligibility({ candidates: [resource, workspace], context: context() });
  assert.equal(forward.report_hash, reverse.report_hash);
  assert.deepEqual(forward.eligible_binding_ids, [resource.binding_id, workspace.binding_id]);
  assert.equal(forward.summary.eligible_count, 2);
  assert.equal(forward.candidate_selected, false);
  assert.equal(forward.selection_authorized, false);
  assert.equal(forward.scoring_performed, false);
  assert.equal(forward.fallback_performed, false);
  assert.equal(forward.preferences_applied, false);
  assert.ok(!JSON.stringify(forward).includes("github://owner/repo"));
  assert.ok(!JSON.stringify(forward).includes("metrics"));
}
{
  const low = filterOperationBindingEligibility({ candidates: [candidate({ metrics: { quality: 0, reliability: 0, preference_match: 0 } })], context: context({ provider_family: null }) });
  const high = filterOperationBindingEligibility({ candidates: [candidate({ metrics: { quality: 1, reliability: 1, preference_match: 1 } })], context: context({ provider_family: null }) });
  assert.equal(low.report_hash, high.report_hash);
  assert.equal(low.summary.eligible_count, 1);
  assert.equal(high.summary.eligible_count, 1);
}
{
  const reasons = evaluateOperationBindingHardConstraints(candidate({
    denied: true,
    deny_reasons: ["workspace_policy_denied", "workspace_policy_denied"],
    status: "disabled",
    valid_from: "2026-07-27T00:00:00Z",
    binding_scope_type: "workspace",
    scope_ref: "workspace-other",
    provider_family: "google",
    capability_key: "repository_write",
    effect_class: "repository_mutation",
    dispatch_allowed: false,
    endpoint_export_ready: false,
    capability_available: false,
    resource_authorized: false,
    credential_ready: false,
    adapter_healthy: false,
    capacity_available: false,
    effect_allowed: false,
    requires_approval: true,
    approval_ready: false,
    requires_readback: true,
    readback_ready: false,
  }), context());
  for (const code of [
    "policy_denied", "deny:workspace_policy_denied", "lifecycle_not_eligible", "not_yet_valid", "scope_mismatch",
    "provider_family_mismatch", "capability_mismatch", "effect_class_mismatch", "dispatch_not_allowed",
    "endpoint_export_not_ready", "capability_unavailable", "resource_authority_missing", "credential_not_ready",
    "adapter_unhealthy", "capacity_unavailable", "effect_not_allowed", "approval_not_ready", "readback_not_ready",
  ]) assert.ok(reasons.includes(code), code);
  assert.deepEqual(reasons, [...reasons].sort());
}
{
  const report = filterOperationBindingEligibility({ candidates: [candidate({ status: "shadow" })], context: context({ compile_mode: "active", provider_family: null }) });
  assert.equal(report.summary.eligible_count, 0);
  assert.ok(report.candidate_evidence[0].exclusion_reasons.includes("lifecycle_not_eligible"));
}
{
  const report = filterOperationBindingEligibility({ candidates: [candidate({ provider_family: "github" })], context: context({ provider_family: null }) });
  assert.ok(report.candidate_evidence[0].exclusion_reasons.includes("provider_context_missing"));
}
assert.throws(
  () => filterOperationBindingEligibility({ candidates: [candidate(), candidate({ binding_key: "binding.duplicate", access_token: "forbidden" })], context: context() }),
  (error) => error instanceof OperationBindingEligibilityError && error.code === "operation_binding_eligibility_secret_field_forbidden",
);
assert.throws(
  () => filterOperationBindingEligibility({ candidates: [candidate(), candidate({ binding_key: "binding.duplicate" })], context: context() }),
  (error) => error.code === "operation_binding_eligibility_duplicate_id",
);
console.log("operation binding eligibility hard-constraint tests passed");
