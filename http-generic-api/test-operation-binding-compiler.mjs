import assert from "node:assert/strict";
import { OperationBindingCompilerError, compileOperationBindingManifest } from "./operationBindingCompiler.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function candidate(overrides = {}) {
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
    ...overrides
  };
}

function input(candidates) {
  return {
    operation: { operation_key: "repo.change.preview", version: 1, revision_hash: HASH_A, operation_class: "repository", risk_level: "medium" },
    context: { compile_mode: "shadow", now: "2026-07-23T04:00:00Z", resource_ref: "github://owner/repo", workspace_id: "workspace-1", tenant_id: "tenant-1", provider_family: "github", required_capability_key: "repository_read", expected_effect_class: "repository_read" },
    candidates,
    compiler_version: "operation-binding-compiler-v1"
  };
}

const resourceLowScore = candidate({
  binding_id: "22222222-2222-4222-8222-222222222222",
  binding_key: "binding.resource.github",
  binding_scope_type: "resource",
  scope_ref: "github://owner/repo",
  provider_family: "github",
  metrics: { quality: 0.1, reliability: 0.1, privacy: 0.1, preference_match: 0.1, context_reuse: 0.1, estimated_cost: 0.9, expected_latency: 0.9, saturation: 0.9 }
});
const workspaceHighScore = candidate({
  binding_id: "33333333-3333-4333-8333-333333333333",
  binding_key: "binding.workspace.github",
  binding_scope_type: "workspace",
  scope_ref: "workspace-1",
  provider_family: "github",
  metrics: { quality: 1, reliability: 1, privacy: 1, preference_match: 1, context_reuse: 1, estimated_cost: 0, expected_latency: 0, saturation: 0 }
});

{
  const forward = compileOperationBindingManifest(input([workspaceHighScore, resourceLowScore]));
  const reverse = compileOperationBindingManifest(input([resourceLowScore, workspaceHighScore]));
  assert.equal(forward.selected_binding.binding_key, "binding.resource.github");
  assert.equal(forward.manifest_hash, reverse.manifest_hash);
  assert.equal(forward.fallback_bindings[0].binding_key, "binding.workspace.github");
  const serialized = JSON.stringify(forward);
  assert.ok(!serialized.includes("github://owner/repo"));
  assert.ok(!serialized.includes("credential_ready"));
  assert.equal(forward.safety.secrets_included, false);
  assert.equal(forward.safety.runtime_activation_changed, false);
}

{
  const deniedResource = candidate({ ...resourceLowScore, denied: true, deny_reasons: ["workspace_policy_denied"] });
  const manifest = compileOperationBindingManifest(input([deniedResource, workspaceHighScore]));
  assert.equal(manifest.selected_binding.binding_key, "binding.workspace.github");
  const evidence = manifest.candidate_evidence.find((entry) => entry.binding_key === "binding.resource.github");
  assert.equal(evidence.eligible, false);
  assert.ok(evidence.exclusion_reasons.includes("policy_denied"));
}

{
  const generic = candidate({ binding_id: "44444444-4444-4444-8444-444444444444", binding_key: "binding.workspace.generic", binding_scope_type: "workspace", scope_ref: "workspace-1", provider_family: null });
  const exact = candidate({ binding_id: "55555555-5555-4555-8555-555555555555", binding_key: "binding.workspace.github-exact", binding_scope_type: "workspace", scope_ref: "workspace-1", provider_family: "github" });
  const manifest = compileOperationBindingManifest(input([generic, exact]));
  assert.equal(manifest.selected_binding.binding_key, "binding.workspace.github-exact");
}

{
  const left = candidate({ binding_id: "66666666-6666-4666-8666-666666666666", binding_key: "binding.workspace.tie-left", binding_scope_type: "workspace", scope_ref: "workspace-1", provider_family: "github" });
  const right = candidate({ binding_id: "77777777-7777-4777-8777-777777777777", binding_key: "binding.workspace.tie-right", binding_scope_type: "workspace", scope_ref: "workspace-1", provider_family: "github" });
  assert.throws(() => compileOperationBindingManifest(input([left, right])), (error) => error instanceof OperationBindingCompilerError && error.code === "blocked_ambiguous_binding" && error.details.conflicting_bindings.length === 2);
}

{
  const expired = candidate({ valid_until: "2026-07-22T00:00:00Z" });
  assert.throws(() => compileOperationBindingManifest(input([expired])), (error) => error.code === "operation_binding_no_eligible_candidate" && error.details.candidate_evidence[0].exclusion_reasons.includes("expired") && !JSON.stringify(error.details).includes("github://owner/repo"));
}

{
  assert.throws(() => compileOperationBindingManifest({ ...input([candidate()]), candidates: [{ ...candidate(), credential_payload: "forbidden" }] }), (error) => error.code === "operation_binding_secret_field_forbidden");
}

console.log("operation binding compiler contract tests passed");
