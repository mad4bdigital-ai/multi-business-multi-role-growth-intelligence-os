import assert from "node:assert/strict";
import {
  OperationBindingKillSwitchError,
  OPERATION_BINDING_KILL_SWITCH_ENV,
  evaluateOperationBindingKillSwitch,
  operationBindingKillSwitchSnapshot,
  resolveOperationBindingKillSwitchPolicy,
} from "./operationBindingKillSwitchPolicy.js";
import { filterOperationBindingEligibility } from "./operationBindingEligibility.js";
import { compileOperationBindingManifest } from "./operationBindingCompiler.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const KILL_SWITCH_ENV_KEYS = Object.values(OPERATION_BINDING_KILL_SWITCH_ENV);

function withKillSwitchEnv(values, callback) {
  const previous = Object.fromEntries(KILL_SWITCH_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of KILL_SWITCH_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values || {})) {
      if (value === null || value === undefined) delete process.env[key];
      else process.env[key] = String(value);
    }
    return callback();
  } finally {
    for (const key of KILL_SWITCH_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function eligibilityCandidate(overrides = {}) {
  return {
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.platform.generic",
    binding_scope_type: "platform",
    scope_ref: null,
    provider_family: null,
    adapter_key: "repository.preview.adapter",
    runtime_key: "managed_api_runtime",
    capability_key: "repository_read",
    effect_class: "repository_read",
    status: "active",
    valid_from: "2026-07-01T00:00:00Z",
    valid_until: "2026-08-01T00:00:00Z",
    revision_hash: HASH_B,
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
    metrics: { quality: 0.7, reliability: 0.8, privacy: 0.9, preference_match: 0.5, context_reuse: 0.5, estimated_cost: 0.4, expected_latency: 0.3, saturation: 0.2 },
    ...overrides,
  };
}

function eligibilityContext(overrides = {}) {
  return {
    compile_mode: "shadow",
    now: "2026-07-27T04:00:00Z",
    resource_ref: "github://owner/repo",
    workspace_id: "workspace-1",
    tenant_id: "tenant-1",
    provider_family: "github",
    required_capability_key: "repository_read",
    expected_effect_class: "repository_read",
    ...overrides,
  };
}

function compilerCandidate(overrides = {}) {
  return {
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.platform.generic",
    binding_scope_type: "platform",
    scope_ref: null,
    provider_family: null,
    effect_class: "repository_read",
    adapter_key: "repository.preview.adapter",
    runtime_key: "managed_api_runtime",
    capability_key: "repository_read",
    dispatch_binding_key: "dispatch.repository.preview",
    endpoint_export_key: "export.repository.preview",
    resource_authority_recipe_key: "repository_read",
    approval_policy_key: null,
    readback_policy_key: "repository_preview_readback_v1",
    priority: 100,
    fallback_rank: 0,
    requires_approval: false,
    requires_readback: true,
    valid_from: "2026-07-01T00:00:00Z",
    valid_until: "2026-08-01T00:00:00Z",
    status: "active",
    revision_hash: HASH_B,
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
    approval_ready: true,
    readback_ready: true,
    metrics: { quality: 0.7, reliability: 0.8, privacy: 0.9, preference_match: 0.5, context_reuse: 0.5, estimated_cost: 0.4, expected_latency: 0.3, saturation: 0.2 },
    ...overrides,
  };
}

function compilerInput(candidates) {
  return {
    operation: { operation_key: "repo.change.preview", version: 1, revision_hash: HASH_A, operation_class: "repository", risk_level: "medium" },
    context: { compile_mode: "shadow", now: "2026-07-27T04:00:00Z", resource_ref: "github://owner/repo", workspace_id: "workspace-1", tenant_id: "tenant-1", provider_family: "github", required_capability_key: "repository_read", expected_effect_class: "repository_read" },
    candidates,
    compiler_version: "operation-binding-compiler-v1",
  };
}

{
  const policy = resolveOperationBindingKillSwitchPolicy({
    [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "adapter.beta, adapter.alpha,adapter.beta",
    [OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys]: "runtime.two,runtime.one",
  });
  const reverse = resolveOperationBindingKillSwitchPolicy({
    [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "adapter.alpha,adapter.beta",
    [OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys]: "runtime.one,runtime.two",
  });
  assert.deepEqual(policy.adapter_keys, ["adapter.alpha", "adapter.beta"]);
  assert.deepEqual(policy.runtime_keys, ["runtime.one", "runtime.two"]);
  assert.equal(policy.policy_hash, reverse.policy_hash);
}

{
  const decision = evaluateOperationBindingKillSwitch({ adapter_key: "repository.preview.adapter", runtime_key: "managed_api_runtime" }, {
    env: {
      [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "repository.preview.adapter",
      [OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys]: "managed_api_runtime",
    },
  });
  assert.equal(decision.blocked, true);
  assert.deepEqual(decision.reason_codes, ["adapter_kill_switch_enabled", "runtime_kill_switch_enabled"]);
}

{
  const snapshot = operationBindingKillSwitchSnapshot({
    [OPERATION_BINDING_KILL_SWITCH_ENV.all_adapters]: "enabled",
    [OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys]: "managed_api_runtime",
  });
  assert.equal(snapshot.adapter_global_enabled, true);
  assert.equal(snapshot.runtime_target_count, 1);
  assert.ok(!JSON.stringify(snapshot).includes("managed_api_runtime"));
}

assert.throws(
  () => resolveOperationBindingKillSwitchPolicy({ [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "adapter.one,,adapter.two" }),
  (error) => error instanceof OperationBindingKillSwitchError && error.code === "operation_binding_kill_switch_list_invalid" && error.status === 503,
);

{
  const report = filterOperationBindingEligibility({
    candidates: [eligibilityCandidate()],
    context: eligibilityContext(),
  }, {
    env: { [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "repository.preview.adapter" },
  });
  assert.equal(report.summary.eligible_count, 0);
  assert.equal(report.summary.kill_switch_excluded_count, 1);
  assert.ok(report.candidate_evidence[0].exclusion_reasons.includes("adapter_kill_switch_enabled"));
  assert.equal(report.kill_switch_policy_hash.length, 64);
}

withKillSwitchEnv({}, () => {
  const primary = compilerCandidate({
    binding_id: "22222222-2222-4222-8222-222222222222",
    binding_key: "binding.resource.primary",
    binding_scope_type: "resource",
    scope_ref: "github://owner/repo",
    provider_family: "github",
    adapter_key: "adapter.primary",
    runtime_key: "runtime.primary",
    priority: 200,
  });
  const fallback = compilerCandidate({
    binding_id: "33333333-3333-4333-8333-333333333333",
    binding_key: "binding.workspace.fallback",
    binding_scope_type: "workspace",
    scope_ref: "workspace-1",
    provider_family: "github",
    adapter_key: "adapter.fallback",
    runtime_key: "runtime.fallback",
    priority: 100,
  });
  const baseline = compileOperationBindingManifest(compilerInput([primary, fallback]));
  const switched = withKillSwitchEnv({ [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "adapter.primary" }, () => (
    compileOperationBindingManifest(compilerInput([primary, fallback]))
  ));
  assert.equal(baseline.selected_binding.binding_id, primary.binding_id);
  assert.equal(switched.selected_binding.binding_id, fallback.binding_id);
  assert.notEqual(baseline.source_revision_hash, switched.source_revision_hash);
  assert.notEqual(baseline.kill_switch_policy_hash, switched.kill_switch_policy_hash);
  const evidence = switched.candidate_evidence.find((entry) => entry.binding_id === primary.binding_id);
  assert.ok(evidence.exclusion_reasons.includes("adapter_kill_switch_enabled"));
  assert.equal(switched.resolution_summary.kill_switch_excluded_count, 1);
});

withKillSwitchEnv({ [OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys]: "managed_api_runtime" }, () => {
  assert.throws(
    () => compileOperationBindingManifest(compilerInput([compilerCandidate()])),
    (error) => error.code === "operation_binding_no_eligible_candidate"
      && error.details.candidate_evidence[0].exclusion_reasons.includes("runtime_kill_switch_enabled"),
  );
});

console.log("operation binding adapter/runtime kill-switch tests passed");
