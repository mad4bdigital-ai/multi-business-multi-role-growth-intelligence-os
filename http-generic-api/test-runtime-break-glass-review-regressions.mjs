import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  RUNTIME_BREAK_GLASS_CONTRACT,
  RUNTIME_BREAK_GLASS_OPERATION_INTENT,
  normalizeRuntimeBreakGlassIncident,
  planRuntimeBreakGlassTransition,
  planRuntimeBreakGlassTransitionWithControlPlane,
} from "./runtimeBreakGlassLifecycle.js";

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";
const uuidD = "44444444-4444-4444-8444-444444444444";
const sha = "a".repeat(40);
const preHash = "b".repeat(64);
const postHash = "d".repeat(64);
const applicationRoot = "/home/u123/domains/auth.mad4b.com/nodejs";
const pathA = `${applicationRoot}/routes/example.js`;
const future30m = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const future1h = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const patchAppliedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const runStartedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const prePatchRunStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function hashes(value = preHash) { return [{ path: pathA, sha256: value }]; }
function postHashes(value = postHash) { return [{ path: pathA, sha256: value }]; }
function incident(overrides = {}) {
  return {
    break_glass_id: uuidA,
    incident_id: "INC-2026-08-11-REVIEW",
    target_id: uuidB,
    target_application_root: applicationRoot,
    environment_key: "production",
    lifecycle_state: "OPEN",
    approving_principal: "platform-admin:mad4bdigital-ai",
    executing_principal: "agent:runtime-recovery",
    capability_envelope_id: uuidC,
    expected_commit_sha: sha,
    reason: "Emergency bounded runtime correction with exact reviewed evidence.",
    allowed_paths: [pathA],
    pre_change_hashes: hashes(),
    rollback_plan: { strategy: "restore_pre_change_bytes", evidence_ref: "incident://rollback/review" },
    audit_correlation: { correlation_id: "audit-break-glass-review", incident_ref: "INC-2026-08-11-REVIEW" },
    runtime_policy_ready: true,
    authorization_expires_at: future30m,
    ...overrides,
  };
}
function scope(raw) {
  const x = normalizeRuntimeBreakGlassIncident(raw);
  return {
    contract: RUNTIME_BREAK_GLASS_CONTRACT,
    operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
    break_glass_id: x.break_glass_id,
    incident_id: x.incident_id,
    target_id: x.target_id,
    target_application_root: x.target_application_root,
    environment_key: x.environment_key,
    approving_principal: x.approving_principal,
    executing_principal: x.executing_principal,
    release_gate_id: x.release_gate_id,
    release_operation_id: x.release_operation_id,
    expected_commit_sha: x.expected_commit_sha,
    reason: x.reason,
    allowed_paths: x.allowed_paths,
    pre_change_hashes: x.pre_change_hashes,
    rollback_plan: x.rollback_plan,
    audit_correlation: x.audit_correlation,
    authorization_expires_at: x.authorization_expires_at,
  };
}
function approved(raw) { return { ...raw, approved_scope_sha256: fingerprint(scope(raw)) }; }
function authority(raw, overrides = {}) {
  const s = scope(raw);
  return {
    envelope_id: uuidC,
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: true,
    apply_allowed: true,
    approval_required: false,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: future1h,
    operation_intent: s.operation_intent,
    expected_commit_sha: s.expected_commit_sha,
    scope_sha256: fingerprint(s),
    secrets_included: false,
    ...overrides,
  };
}
function verificationEvidence() {
  return {
    runtime_verification_run_id: uuidD,
    runtime_verification: {
      status: "verified",
      post_change_hashes_verified: true,
      readback_hashes: postHashes(),
      secrets_included: false,
    },
  };
}
function runReadback(overrides = {}) {
  return {
    run_id: uuidD,
    surface_key: "runtime_break_glass_file_readback",
    readback_hashes: postHashes(),
    chunk_count: 1,
    incomplete: false,
    invalid_run_binding: false,
    secrets_included: false,
    ...overrides,
  };
}
function run(overrides = {}) {
  return {
    run_id: uuidD,
    environment_key: "production",
    expected_commit_sha: sha,
    deployed_commit_sha: sha,
    run_status: "verified",
    production_parity: "verified",
    summary: { blocking_gap_count: 0 },
    gaps: [],
    started_at: runStartedAt,
    completed_at: new Date().toISOString(),
    runtime_break_glass_readback: runReadback(),
    secrets_included: false,
    ...overrides,
  };
}

{
  const raw = incident();
  const sync = planRuntimeBreakGlassTransition({ incident: raw, to_state: "APPROVED" });
  assert.equal(sync.decision, "blocked");
  assert(sync.blockers.includes("BREAK_GLASS_ENVELOPE_LEDGER_LOOKUP_REQUIRED"));
  const result = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED" },
    { loadCapabilityEnvelopeAuthority: async () => authority(raw) },
  );
  assert.equal(result.decision, "eligible_shadow");
  assert.equal(result.event_preview.actor, raw.approving_principal);
  assert.equal(result.event_preview.evidence.authority.authority_source, "capability_resolution_envelope_ledger");

  const fabricated = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED", evidence: { authority: { capability_envelope_id: uuidC, dispatch_allowed: true, apply_allowed: true, scope_sha256: fingerprint(scope(raw)), secrets_included: false } } },
    { loadCapabilityEnvelopeAuthority: async () => null },
  );
  assert.equal(fabricated.decision, "blocked");
  assert(fabricated.blockers.includes("BREAK_GLASS_ENVELOPE_LEDGER_NOT_FOUND"));
}

{
  const raw = approved(incident({ lifecycle_state: "APPROVED" }));
  const result = planRuntimeBreakGlassTransition({
    incident: raw,
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: {
      mutation_method: "bounded_file_patch",
      freeform_shell: false,
      filesystem_scope_exact: true,
      pre_change_readback_hashes: hashes(),
      post_change_hashes: hashes(),
      post_change_readback_hashes: hashes(),
    },
  });
  assert.equal(result.decision, "blocked");
  assert(result.blockers.includes("BREAK_GLASS_NO_OP_PATCH_FORBIDDEN"));

  const revoked = planRuntimeBreakGlassTransition({
    incident: { ...raw, runtime_policy_ready: false },
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: {
      mutation_method: "bounded_file_patch",
      freeform_shell: false,
      filesystem_scope_exact: true,
      pre_change_readback_hashes: hashes(),
      post_change_hashes: postHashes(),
      post_change_readback_hashes: postHashes(),
    },
  });
  assert.equal(revoked.decision, "blocked");
  assert(revoked.blockers.includes("BREAK_GLASS_RUNTIME_POLICY_NOT_READY"));
}

{
  const original = approved(incident({ lifecycle_state: "APPROVED" }));
  const mutated = { ...original, executing_principal: "agent:other-runtime" };
  const result = planRuntimeBreakGlassTransition({
    incident: mutated,
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: {
      mutation_method: "bounded_file_patch",
      freeform_shell: false,
      filesystem_scope_exact: true,
      pre_change_readback_hashes: hashes(),
      post_change_hashes: postHashes(),
      post_change_readback_hashes: postHashes(),
    },
  });
  assert.equal(result.decision, "blocked");
  assert(result.blockers.includes("BREAK_GLASS_APPROVED_SCOPE_MISMATCH"));
}

{
  const applied = approved(incident({ lifecycle_state: "LOCAL_PATCH_APPLIED", post_change_hashes: postHashes(), local_patch_applied_at: patchAppliedAt }));
  const result = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run() },
  );
  assert.equal(result.decision, "blocked");
  assert(result.blockers.includes("BREAK_GLASS_PERSISTED_POST_CHANGE_READBACK_REQUIRED"));
}

{
  const applied = approved(incident({
    lifecycle_state: "LOCAL_PATCH_APPLIED",
    post_change_hashes: postHashes(),
    post_change_readback_hashes: postHashes("f".repeat(64)),
    local_patch_applied_at: patchAppliedAt,
  }));
  const result = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run() },
  );
  assert.equal(result.decision, "blocked");
  assert(result.blockers.includes("BREAK_GLASS_PERSISTED_POST_CHANGE_READBACK_MISMATCH"));
}

{
  const applied = approved(incident({
    lifecycle_state: "LOCAL_PATCH_APPLIED",
    post_change_hashes: postHashes(),
    post_change_readback_hashes: postHashes(),
    local_patch_applied_at: patchAppliedAt,
  }));
  const missing = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => null, loadRuntimeVerificationReadback: async () => runReadback() },
  );
  assert.equal(missing.decision, "blocked");
  assert(missing.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_NOT_FOUND"));

  const unrelated = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run({ environment_key: "staging", expected_commit_sha: "f".repeat(40) }) },
  );
  assert.equal(unrelated.decision, "blocked");
  assert(unrelated.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_ENVIRONMENT_MISMATCH"));
  assert(unrelated.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_EXPECTED_COMMIT_MISMATCH"));

  const stale = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run({ started_at: prePatchRunStartedAt }) },
  );
  assert.equal(stale.decision, "blocked");
  assert(stale.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_PREDATES_PATCH"));

  const inventedReadback = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run({ runtime_break_glass_readback: runReadback({ readback_hashes: postHashes("f".repeat(64)) }) }) },
  );
  assert.equal(inventedReadback.decision, "blocked");
  assert(inventedReadback.blockers.includes("BREAK_GLASS_RUNTIME_READBACK_HASH_MISMATCH"));

  const ok = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence: verificationEvidence() },
    { loadRuntimeVerificationRun: async () => run() },
  );
  assert.equal(ok.decision, "eligible_shadow");
  assert.equal(ok.event_preview.actor, "agent:runtime-recovery");
  assert.equal(ok.incident_update_preview.runtime_verification_run_id, uuidD);
  assert.equal(ok.incident_update_preview.runtime_verification.status, "verified");
  assert.deepEqual(ok.incident_update_preview.runtime_verification.readback_hashes, postHashes());
  assert.equal(ok.database_write_performed, false);
  assert.equal(ok.hostinger_mutation_performed, false);
}

{
  const original = approved(incident({ lifecycle_state: "LOCAL_PATCH_APPLIED" }));
  const mutated = { ...original, pre_change_hashes: hashes("f".repeat(64)) };
  const result = planRuntimeBreakGlassTransition({
    incident: mutated,
    to_state: "ROLLED_BACK",
    evidence: { rollback_applied: true, rollback_readback_verified: true, rollback_readback_hashes: hashes("f".repeat(64)), secrets_included: false },
  });
  assert.equal(result.decision, "blocked");
  assert(result.blockers.includes("BREAK_GLASS_APPROVED_SCOPE_MISMATCH"));
}

console.log("runtime break-glass review regressions: ok");
