import assert from "node:assert/strict";
import { compileOperationBindingManifest } from "./operationBindingCompiler.js";
import { OPERATION_BINDING_KILL_SWITCH_ENV } from "./operationBindingKillSwitchPolicy.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const KILL_SWITCH_ENV_KEYS = Object.values(OPERATION_BINDING_KILL_SWITCH_ENV);
const PREFERENCE_ONLY_WEIGHTS = Object.freeze({
  quality: 0,
  reliability: 0,
  privacy: 0,
  preference_match: 1,
  context_reuse: 0,
  estimated_cost: 0,
  expected_latency: 0,
  saturation: 0,
});

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

function metrics(preferenceMatch) {
  return {
    quality: 0.5,
    reliability: 0.5,
    privacy: 0.5,
    preference_match: preferenceMatch,
    context_reuse: 0.5,
    estimated_cost: 0.5,
    expected_latency: 0.5,
    saturation: 0.5,
  };
}

function candidate({ id, key, adapterKey, runtimeKey, preference = 0.5, ...overrides }) {
  return {
    binding_id: id,
    binding_key: key,
    binding_scope_type: "resource",
    scope_ref: "github://owner/repo",
    provider_family: "github",
    effect_class: "repository_read",
    adapter_key: adapterKey,
    runtime_key: runtimeKey,
    capability_key: "repository_read",
    dispatch_binding_key: `dispatch.${key}`,
    endpoint_export_key: `export.${key}`,
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
    metrics: metrics(preference),
    ...overrides,
  };
}

function compileInput(candidates, { preferenceOnly = false } = {}) {
  return {
    operation: {
      operation_key: "repo.change.preview",
      version: 1,
      revision_hash: HASH_A,
      operation_class: "repository",
      risk_level: "medium",
    },
    context: {
      compile_mode: "shadow",
      now: "2026-07-28T01:30:00Z",
      resource_ref: "github://owner/repo",
      workspace_id: "workspace-1",
      tenant_id: "tenant-1",
      provider_family: "github",
      required_capability_key: "repository_read",
      expected_effect_class: "repository_read",
    },
    candidates,
    ...(preferenceOnly ? { policy: { weights: PREFERENCE_ONLY_WEIGHTS } } : {}),
    compiler_version: "operation-binding-compiler-v1",
  };
}

function evidenceFor(manifest, bindingId) {
  return manifest.candidate_evidence.find((entry) => entry.binding_id === bindingId);
}

function assertNoAuthorityCreated(manifest) {
  assert.equal(manifest.fallback_plan.selection_authorized, false);
  assert.equal(manifest.fallback_plan.dispatch_authorized, false);
  assert.equal(manifest.fallback_plan.authority_created, false);
  assert.equal(manifest.fallback_plan.fallback_executed, false);
  assert.equal(manifest.resolver_explain.selection_authorized, false);
  assert.equal(manifest.resolver_explain.dispatch_authorized, false);
  assert.equal(manifest.resolver_explain.authority_created, false);
  assert.equal(manifest.resolver_explain.fallback_executed, false);
  assert.equal(manifest.resolver_explain.candidate_recomputed, false);
  assert.equal(manifest.resolver_explain.scoring_recomputed, false);
}

withKillSwitchEnv({}, () => {
  const authorized = candidate({
    id: "11111111-1111-4111-8111-111111111111",
    key: "binding.authorized.low-preference",
    adapterKey: "adapter.authorized",
    runtimeKey: "runtime.authorized",
    preference: 0,
  });
  const preferredButUnauthorized = candidate({
    id: "22222222-2222-4222-8222-222222222222",
    key: "binding.unauthorized.high-preference",
    adapterKey: "adapter.unauthorized",
    runtimeKey: "runtime.unauthorized",
    preference: 1,
    resource_authorized: false,
  });
  const manifest = compileOperationBindingManifest(compileInput([preferredButUnauthorized, authorized], { preferenceOnly: true }));
  assert.equal(manifest.selected_binding.binding_id, authorized.binding_id);
  const blocked = evidenceFor(manifest, preferredButUnauthorized.binding_id);
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.exclusion_reasons.includes("resource_authority_missing"));
  assert.ok(!manifest.fallback_plan.fallback_binding_ids.includes(preferredButUnauthorized.binding_id));
  assert.equal(manifest.resolver_explain.candidate_evidence.find((entry) => entry.binding_id === preferredButUnauthorized.binding_id).disposition, "excluded");
  assertNoAuthorityCreated(manifest);
});

withKillSwitchEnv({}, () => {
  const authorized = candidate({
    id: "33333333-3333-4333-8333-333333333333",
    key: "binding.ready.low-preference",
    adapterKey: "adapter.ready",
    runtimeKey: "runtime.ready",
    preference: 0,
  });
  const preferredButUnready = candidate({
    id: "44444444-4444-4444-8444-444444444444",
    key: "binding.unready.high-preference",
    adapterKey: "adapter.unready",
    runtimeKey: "runtime.unready",
    preference: 1,
    dispatch_allowed: false,
    endpoint_export_ready: false,
    credential_ready: false,
    requires_approval: true,
    approval_policy_key: "approval.required",
    approval_ready: false,
    readback_ready: false,
  });
  const manifest = compileOperationBindingManifest(compileInput([preferredButUnready, authorized], { preferenceOnly: true }));
  assert.equal(manifest.selected_binding.binding_id, authorized.binding_id);
  const blocked = evidenceFor(manifest, preferredButUnready.binding_id);
  for (const reason of [
    "dispatch_not_allowed",
    "endpoint_export_not_ready",
    "credential_not_ready",
    "approval_not_ready",
    "readback_not_ready",
  ]) assert.ok(blocked.exclusion_reasons.includes(reason), reason);
  assertNoAuthorityCreated(manifest);
});

withKillSwitchEnv({}, () => {
  const authorized = candidate({
    id: "55555555-5555-4555-8555-555555555555",
    key: "binding.policy-allowed.low-preference",
    adapterKey: "adapter.policy-allowed",
    runtimeKey: "runtime.policy-allowed",
    preference: 0,
  });
  const preferredButDenied = candidate({
    id: "66666666-6666-4666-8666-666666666666",
    key: "binding.policy-denied.high-preference",
    adapterKey: "adapter.policy-denied",
    runtimeKey: "runtime.policy-denied",
    preference: 1,
    denied: true,
    deny_reasons: ["preference_cannot_override_policy"],
  });
  const manifest = compileOperationBindingManifest(compileInput([preferredButDenied, authorized], { preferenceOnly: true }));
  assert.equal(manifest.selected_binding.binding_id, authorized.binding_id);
  const blocked = evidenceFor(manifest, preferredButDenied.binding_id);
  assert.ok(blocked.exclusion_reasons.includes("policy_denied"));
  assert.ok(blocked.exclusion_reasons.includes("deny:preference_cannot_override_policy"));
  assertNoAuthorityCreated(manifest);
});

withKillSwitchEnv({
  [OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys]: "adapter.preferred-disabled",
}, () => {
  const authorized = candidate({
    id: "77777777-7777-4777-8777-777777777777",
    key: "binding.enabled.low-preference",
    adapterKey: "adapter.enabled",
    runtimeKey: "runtime.enabled",
    preference: 0,
  });
  const preferredButDisabled = candidate({
    id: "88888888-8888-4888-8888-888888888888",
    key: "binding.disabled.high-preference",
    adapterKey: "adapter.preferred-disabled",
    runtimeKey: "runtime.preferred-disabled",
    preference: 1,
  });
  const manifest = compileOperationBindingManifest(compileInput([preferredButDisabled, authorized], { preferenceOnly: true }));
  assert.equal(manifest.selected_binding.binding_id, authorized.binding_id);
  const blocked = evidenceFor(manifest, preferredButDisabled.binding_id);
  assert.ok(blocked.exclusion_reasons.includes("adapter_kill_switch_enabled"));
  assert.equal(manifest.resolution_summary.kill_switch_excluded_count, 1);
  assertNoAuthorityCreated(manifest);
});

withKillSwitchEnv({}, () => {
  const lowPreference = candidate({
    id: "99999999-9999-4999-8999-999999999999",
    key: "binding.eligible.low-preference",
    adapterKey: "adapter.eligible-low",
    runtimeKey: "runtime.eligible-low",
    preference: 0,
  });
  const highPreference = candidate({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    key: "binding.eligible.high-preference",
    adapterKey: "adapter.eligible-high",
    runtimeKey: "runtime.eligible-high",
    preference: 1,
  });
  const manifest = compileOperationBindingManifest(compileInput([lowPreference, highPreference], { preferenceOnly: true }));
  assert.equal(manifest.selected_binding.binding_id, highPreference.binding_id);
  assert.ok(evidenceFor(manifest, highPreference.binding_id).score > evidenceFor(manifest, lowPreference.binding_id).score);
  assertNoAuthorityCreated(manifest);

  const inputIds = new Set([lowPreference.binding_id, highPreference.binding_id]);
  const projectedIds = new Set([
    manifest.selected_binding.binding_id,
    ...manifest.fallback_bindings.map((entry) => entry.binding_id),
    ...manifest.fallback_plan.fallback_binding_ids,
    ...manifest.fallback_plan.overflow_binding_ids,
    ...manifest.candidate_evidence.map((entry) => entry.binding_id),
    ...manifest.resolver_explain.candidate_evidence.map((entry) => entry.binding_id),
  ]);
  for (const bindingId of projectedIds) assert.ok(inputIds.has(bindingId), bindingId);
  assert.ok(!JSON.stringify(manifest).includes("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
});

console.log("operation binding preference authority negative tests passed");
