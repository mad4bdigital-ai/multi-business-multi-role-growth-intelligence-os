import assert from "node:assert/strict";
import { buildOperationAuthorityPreflight } from "./operationAuthorityPreflight.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function input(overrides = {}) {
  return {
    runtime_verification: {
      operation_key: "repo.change.preview",
      operation_version: 1,
      scope_fingerprint: HASH_A,
      allowed_compiler_versions: ["operation-binding-compiler-v1"],
      allowed_rollout_modes: ["shadow", "canary", "active"],
      now: "2026-07-24T08:00:00.000Z"
    },
    capability: {
      capability_key: "repository_read",
      requested_mode: "apply",
      principal_scope: "admin",
      resource_ref: "github://owner/repo",
      runtime_surface: "repository_preview_runtime",
      capability_envelope_id: "11111111-1111-4111-8111-111111111111",
      legacy_decision: "allow",
      evidence: {
        resource_authority: true,
        credential_scope_match: true,
        capability_grant: true,
        readback_contract: true
      }
    },
    kill_switch: {
      surface: "local_file_mutation",
      action: "write"
    },
    evidence_hashes: {
      resource_authority: HASH_A,
      credential_scope_match: HASH_B,
      capability_grant: HASH_C,
      readback_contract: "d".repeat(64)
    },
    ...overrides
  };
}

function runtimeReport(overrides = {}) {
  return {
    ok: true,
    verification_status: "ready_for_runtime_authority_resolution",
    operation_key: "repo.change.preview",
    operation_version: 1,
    scope_fingerprint: HASH_A,
    manifest_evidence: {
      manifest_id: "manifest-1",
      manifest_version: 1,
      manifest_hash: HASH_B,
      source_revision_hash: HASH_C,
      compiler_version: "operation-binding-compiler-v1",
      validation_status: "valid",
      rollout_mode: "shadow",
      certification_status: "certified",
      pointer_revision: 1,
      is_current: true
    },
    authority_evidence: {
      dispatch_binding: {
        capability_key: "repository_read",
        runtime_surface: "repository_preview_runtime",
        dispatch_binding_key: "dispatch.repository.preview"
      }
    },
    blockers: [],
    ...overrides
  };
}

function shadowReport(overrides = {}) {
  return {
    ok: true,
    shadow_version: "dynamic-capability-enforcement-shadow-v1",
    capability_key: "repository_read",
    requested_mode: "apply",
    request_hash: HASH_A,
    decision_hash: HASH_B,
    adaptive_decision: "ready_for_dispatch",
    effective_authority_decision: "allow",
    blockers: [],
    next_actions: [],
    gates: [
      { gate: "resource_authority", state: "pass", required: true, reason_code: null, evidence_ref: "raw-ref-must-not-return" },
      { gate: "credential_scope", state: "pass", required: true, reason_code: null },
      { gate: "capability_grant", state: "pass", required: true, reason_code: null },
      { gate: "readback_contract", state: "pass", required: true, reason_code: null },
      { gate: "capability_envelope", state: "pass", required: true, reason_code: null, evidence_ref: "envelope-id" },
      { gate: "certification", state: "pass", required: true, reason_code: null, evidence_ref: "certification-id" }
    ],
    manifest: {
      manifest_id: "capability-manifest-1",
      manifest_version: 1,
      manifest_hash: HASH_B,
      source_revision_hash: HASH_C,
      compiler_version: "dynamic-capability-governance-v1",
      effect_class: "external_write",
      risk_class: "R2",
      status: "active",
      rollout_mode: "active",
      requirements: { credential_reference: true },
      source: { table: "admin_platform_endpoint_tools", key: "repo_change_preview" }
    },
    parity: { blocking: false },
    evidence: { certification: { certification: { last_evidence_ref: "must-not-return" } } },
    ...overrides
  };
}

function deps({ runtime = runtimeReport(), shadow = shadowReport(), killSwitch = null } = {}) {
  const calls = { runtime: 0, shadow: 0, killSwitch: 0, shadowInput: null };
  return {
    calls,
    value: {
      verifyRuntime: async () => {
        calls.runtime += 1;
        return runtime;
      },
      buildCapabilityShadow: async (shadowInput) => {
        calls.shadow += 1;
        calls.shadowInput = shadowInput;
        return shadow;
      },
      evaluateKillSwitch: () => {
        calls.killSwitch += 1;
        return killSwitch || {
          blocked: false,
          surface: "local_file_mutation",
          action: "write",
          mutation: true,
          switch_enabled: false,
          switch_key: "local_file_mutation",
          env_var: "CAPABILITY_KILL_SWITCH_LOCAL_FILE_MUTATION",
          secrets_included: false
        };
      }
    }
  };
}

{
  const dependency = deps();
  const result = await buildOperationAuthorityPreflight(input(), dependency.value);
  assert.equal(result.ok, true);
  assert.equal(result.preflight_status, "ready_for_governed_authority_handoff");
  assert.equal(result.next_stage, "governed_runtime_authority_resolution");
  assert.equal(result.runtime_dispatch_authorized, false);
  assert.equal(result.execution_performed, false);
  assert.equal(result.database_writes_performed, false);
  assert.equal(result.provider_calls_performed, false);
  assert.equal(result.credential_payloads_read, false);
  assert.equal(result.runtime_activation_changed, false);
  assert.equal(dependency.calls.runtime, 1);
  assert.equal(dependency.calls.shadow, 1);
  assert.equal(dependency.calls.killSwitch, 1);
  assert.equal(dependency.calls.shadowInput.expected_manifest_hash, HASH_B);
  assert.equal(dependency.calls.shadowInput.expected_source_revision_hash, HASH_C);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("github://owner/repo"));
  assert.ok(!serialized.includes("raw-ref-must-not-return"));
  assert.ok(!serialized.includes("must-not-return"));
}

{
  const dependency = deps({ runtime: runtimeReport({ ok: false, verification_status: "blocked_runtime_verification" }) });
  const result = await buildOperationAuthorityPreflight(input(), dependency.value);
  assert.equal(result.ok, false);
  assert.equal(result.preflight_status, "blocked_authority_preflight");
  assert.ok(result.blockers.some((item) => item.code === "runtime_verification_not_ready"));
  assert.equal(dependency.calls.shadow, 0);
  assert.equal(dependency.calls.killSwitch, 1);
}

{
  const dependency = deps({ shadow: shadowReport({ adaptive_decision: "ready_requires_approval", blockers: ["APPROVAL_REQUIRED"] }) });
  const result = await buildOperationAuthorityPreflight(input(), dependency.value);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === "adaptive_authority_not_ready"));
  assert.ok(result.blockers.some((item) => item.code === "APPROVAL_REQUIRED"));
  assert.equal(result.runtime_dispatch_authorized, false);
}

{
  const request = input({
    evidence_hashes: {
      resource_authority: HASH_A,
      capability_grant: HASH_C,
      readback_contract: "d".repeat(64)
    }
  });
  const result = await buildOperationAuthorityPreflight(request, deps().value);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === "authority_evidence_hash_missing" && item.evidence_key === "credential_scope_match"));
}

{
  const dependency = deps({
    killSwitch: {
      blocked: true,
      surface: "local_file_mutation",
      action: "write",
      mutation: true,
      switch_enabled: true,
      switch_key: "local_file_mutation",
      env_var: "CAPABILITY_KILL_SWITCH_LOCAL_FILE_MUTATION",
      secrets_included: false
    }
  });
  const result = await buildOperationAuthorityPreflight(input(), dependency.value);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === "capability_kill_switch_enabled"));
}

{
  const dependency = deps({ shadow: shadowReport({ effective_authority_decision: "deny" }) });
  const result = await buildOperationAuthorityPreflight(input(), dependency.value);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === "legacy_authority_not_allowing"));
}

await assert.rejects(
  buildOperationAuthorityPreflight({
    ...input(),
    capability: {
      ...input().capability,
      credential_payload: "forbidden"
    }
  }, deps().value),
  (error) => error.code === "operation_authority_preflight_sensitive_field_forbidden"
);

console.log("operation authority preflight contract tests passed");
