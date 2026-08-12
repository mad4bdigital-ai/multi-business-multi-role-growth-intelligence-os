import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  RUNTIME_BREAK_GLASS_CONTRACT,
  RUNTIME_BREAK_GLASS_OPERATION_INTENT,
  RUNTIME_BREAK_GLASS_TRANSITIONS,
  normalizeRuntimeBreakGlassIncident,
  planRuntimeBreakGlassTransition,
  planRuntimeBreakGlassTransitionWithControlPlane,
} from "./runtimeBreakGlassLifecycle.js";

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";
const uuidD = "44444444-4444-4444-8444-444444444444";
const uuidE = "55555555-5555-4555-8555-555555555555";
const sha = "a".repeat(40);
const hashA = "b".repeat(64);
const hashB = "c".repeat(64);
const postHashA = "d".repeat(64);
const postHashB = "e".repeat(64);
const applicationRoot = "/home/u123/domains/auth.mad4b.com/nodejs";
const pathA = `${applicationRoot}/routes/example.js`;
const pathB = `${applicationRoot}/services/example.js`;
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const laterFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const patchTime = new Date(Date.now() - 5 * 60 * 1000);
const patchAppliedAt = patchTime.toISOString();
const runStartedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const prePatchRunStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function preChangeHashes(overrides = {}) {
  return [
    { path: pathA, sha256: overrides[pathA] || hashA },
    { path: pathB, sha256: overrides[pathB] || hashB },
  ];
}

function postChangeHashes(overrides = {}) {
  return [
    { path: pathA, sha256: overrides[pathA] || postHashA },
    { path: pathB, sha256: overrides[pathB] || postHashB },
  ];
}

function incident(overrides = {}) {
  return {
    break_glass_id: uuidA,
    incident_id: "INC-2026-08-10-001",
    target_id: uuidB,
    target_application_root: applicationRoot,
    environment_key: "production",
    lifecycle_state: "OPEN",
    approving_principal: "platform-admin:mad4bdigital-ai",
    executing_principal: "agent:runtime-recovery",
    capability_envelope_id: uuidC,
    expected_commit_sha: sha,
    reason: "Emergency bounded runtime correction with explicit incident scope.",
    allowed_paths: [pathA, pathB],
    pre_change_hashes: preChangeHashes(),
    rollback_plan: { strategy: "restore_pre_change_bytes", evidence_ref: "incident://rollback-plan/001" },
    audit_correlation: { correlation_id: "audit-break-glass-001", incident_ref: "INC-2026-08-10-001" },
    runtime_policy_ready: true,
    authorization_expires_at: future,
    ...overrides,
  };
}

function approvalScope(rawIncident = incident()) {
  const normalized = normalizeRuntimeBreakGlassIncident(rawIncident);
  return {
    contract: RUNTIME_BREAK_GLASS_CONTRACT,
    operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
    break_glass_id: normalized.break_glass_id,
    incident_id: normalized.incident_id,
    target_id: normalized.target_id,
    target_application_root: normalized.target_application_root,
    environment_key: normalized.environment_key,
    approving_principal: normalized.approving_principal,
    executing_principal: normalized.executing_principal,
    release_gate_id: normalized.release_gate_id,
    release_operation_id: normalized.release_operation_id,
    expected_commit_sha: normalized.expected_commit_sha,
    reason: normalized.reason,
    allowed_paths: normalized.allowed_paths,
    pre_change_hashes: normalized.pre_change_hashes,
    rollback_plan: normalized.rollback_plan,
    audit_correlation: normalized.audit_correlation,
    authorization_expires_at: normalized.authorization_expires_at,
  };
}

function approved(rawIncident) {
  return { ...rawIncident, approved_scope_sha256: fingerprint(approvalScope(rawIncident)) };
}

function authority(rawIncident = incident(), overrides = {}) {
  const scope = approvalScope(rawIncident);
  return {
    envelope_id: uuidC,
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: true,
    apply_allowed: true,
    approval_required: false,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: future,
    operation_intent: scope.operation_intent,
    expected_commit_sha: scope.expected_commit_sha,
    scope_sha256: fingerprint(scope),
    secrets_included: false,
    ...overrides,
  };
}

function verifiedRuntime(overrides = {}) {
  return {
    status: "verified",
    post_change_hashes_verified: true,
    readback_hashes: postChangeHashes(),
    secrets_included: false,
    ...overrides,
  };
}

function runReadback(overrides = {}) {
  return {
    run_id: uuidD,
    surface_key: "runtime_break_glass_file_readback",
    readback_hashes: postChangeHashes(),
    chunk_count: 1,
    incomplete: false,
    invalid_run_binding: false,
    secrets_included: false,
    ...overrides,
  };
}

function verifiedRun(overrides = {}) {
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

assert.deepEqual(RUNTIME_BREAK_GLASS_TRANSITIONS.OPEN, ["APPROVED"]);
assert.deepEqual(RUNTIME_BREAK_GLASS_TRANSITIONS.LOCAL_PATCH_APPLIED, ["RUNTIME_VERIFIED", "ROLLED_BACK"]);
assert.deepEqual(RUNTIME_BREAK_GLASS_TRANSITIONS.RUNTIME_VERIFIED, ["RECONCILING", "ROLLED_BACK"]);

{
  const normalized = normalizeRuntimeBreakGlassIncident(incident());
  assert.equal(normalized.target_application_root, applicationRoot);
  assert.deepEqual(normalized.allowed_paths, [pathA, pathB].sort());
  assert.equal(normalized.secrets_included, false);
}

{
  for (const unsafePath of [applicationRoot, `${applicationRoot}/.`, `${applicationRoot}/./`]) {
    assert.throws(
      () => normalizeRuntimeBreakGlassIncident(incident({ allowed_paths: [unsafePath], pre_change_hashes: [{ path: unsafePath, sha256: hashA }] })),
      (error) => error.code === "BREAK_GLASS_PATH_TOO_BROAD",
    );
  }
  assert.throws(
    () => normalizeRuntimeBreakGlassIncident(incident({
      allowed_paths: ["/home/u123/domains/auth.mad4b.com/public_html/.htaccess"],
      pre_change_hashes: [{ path: "/home/u123/domains/auth.mad4b.com/public_html/.htaccess", sha256: hashA }],
    })),
    (error) => error.code === "BREAK_GLASS_PATH_OUTSIDE_TARGET_APPLICATION_ROOT",
  );
  assert.throws(
    () => normalizeRuntimeBreakGlassIncident(incident({ target_application_root: "/home/u123/domains/auth.mad4b.com/public_html" })),
    (error) => error.code === "BREAK_GLASS_APPLICATION_ROOT_INVALID",
  );
}

{
  const raw = incident();
  const sync = planRuntimeBreakGlassTransition({ incident: raw, to_state: "APPROVED" });
  assert.equal(sync.decision, "blocked");
  assert(sync.blockers.includes("BREAK_GLASS_ENVELOPE_LEDGER_LOOKUP_REQUIRED"));

  const eligible = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED" },
    { loadCapabilityEnvelopeAuthority: async () => authority(raw) },
  );
  assert.equal(eligible.decision, "eligible_shadow");
  assert.equal(eligible.event_preview.actor, raw.approving_principal);
  assert.equal(eligible.event_preview.evidence.authority.authority_source, "capability_resolution_envelope_ledger");
  assert.equal(eligible.incident_update_preview.approved_scope_sha256, fingerprint(approvalScope(raw)));
  assert.equal(eligible.event_preview.approved_scope_sha256, fingerprint(approvalScope(raw)));
  assert.equal(eligible.database_write_performed, false);
  assert.equal(eligible.hostinger_mutation_performed, false);

  const wrongScope = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED" },
    { loadCapabilityEnvelopeAuthority: async () => authority(raw, { scope_sha256: "f".repeat(64) }) },
  );
  assert.equal(wrongScope.decision, "blocked");
  assert(wrongScope.blockers.includes("BREAK_GLASS_ENVELOPE_SCOPE_FINGERPRINT_MISMATCH"));

  const missingLedger = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED", evidence: { authority: { envelope_id: uuidC, scope_sha256: fingerprint(approvalScope(raw)), dispatch_allowed: true, apply_allowed: true, secrets_included: false } } },
    { loadCapabilityEnvelopeAuthority: async () => null },
   );
  assert.equal(missingLedger.decision, "blocked");
  assert(missingLedger.blockers.includes("BREAK_GLASS_ENVELOPE_LEDGER_NOT_FOUND"));

  const overlong = incident({ authorization_expires_at: laterFuture });
  const overlongResult = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: overlong, to_state: "APPROVED" },
    { loadCapabilityEnvelopeAuthority: async () => authority(overlong, { expires_at: future }) },
  );
  assert.equal(overlongResult.decision, "blocked");
  assert(overlongResult.blockers.includes("BREAK_GLASS_AUTHORIZATION_EXCEEDS_ENVELOPE_EXPIRY"));
}

{
  const rawApproved = approved(incident({ lifecycle_state: "APPROVED" }));
  const patchEvidence = {
    mutation_method: "bounded_file_patch",
    freeform_shell: false,
    filesystem_scope_exact: true,
    pre_change_readback_hashes: preChangeHashes(),
    post_change_hashes: postChangeHashes(),
    post_change_readback_hashes: postChangeHashes(),
  };
  const eligible = planRuntimeBreakGlassTransition({ incident: rawApproved, to_state: "LOCAL_PATCH_APPLIED", evidence: patchEvidence, now: patchTime });
  assert.equal(eligible.decision, "eligible_shadow");
  assert.deepEqual(eligible.incident_update_preview.post_change_hashes, postChangeHashes());
  assert.deepEqual(eligible.incident_update_preview.post_change_readback_hashes, postChangeHashes());
  assert.equal(eligible.incident_update_preview.local_patch_applied_at, patchAppliedAt);

  const revoked = planRuntimeBreakGlassTransition({ incident: { ...rawApproved, runtime_policy_ready: false }, to_state: "LOCAL_PATCH_APPLIED", evidence: patchEvidence });
  assert.equal(revoked.decision, "blocked");
  assert(revoked.blockers.includes("BREAK_GLASS_RUNTIME_POLICY_NOT_READY"));

  const chainedApplied = { ...rawApproved, ...eligible.incident_update_preview };
  const chainedRuntime = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: chainedApplied, to_state: "RUNTIME_VERIFIED", evidence: { runtime_verification_run_id: uuidD, runtime_verification: verifiedRuntime() } },
    { loadRuntimeVerificationRun: async () => verifiedRun() },
  );
  assert.equal(chainedRuntime.decision, "eligible_shadow");
  assert.equal(chainedRuntime.incident_update_preview.runtime_verification_run_id, uuidD);
  assert.equal(chainedRuntime.incident_update_preview.runtime_verification.status, "verified");
  assert.deepEqual(chainedRuntime.incident_update_preview.runtime_verification.readback_hashes, postChangeHashes());
  assert(chainedRuntime.incident_update_preview.runtime_verified_at);
  const chainedVerified = { ...chainedApplied, ...chainedRuntime.incident_update_preview };
  const chainedReconcile = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: chainedVerified, to_state: "RECONCILING" },
    { loadRuntimeVerificationRun: async () => verifiedRun() },
   );
  assert.equal(chainedReconcile.decision, "eligible_shadow");
  assert(chainedReconcile.incident_update_preview.reconciliation_started_at);

  const noBinding = planRuntimeBreakGlassTransition({
    incident: incident({ lifecycle_state: "APPROVED" }),
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: patchEvidence,
  });
  assert.equal(noBinding.decision, "blocked");
  assert(noBinding.blockers.includes("BREAK_GLASS_APPROVED_SCOPE_BINDING_REQUIRED"));

  const drifted = { ...rawApproved, reason: "Emergency bounded runtime correction changed after approval and must be rejected." };
  const drift = planRuntimeBreakGlassTransition({ incident: drifted, to_state: "LOCAL_PATCH_APPLIED", evidence: patchEvidence });
  assert.equal(drift.decision, "blocked");
  assert(drift.blockers.includes("BREAK_GLASS_APPROVED_SCOPE_MISMATCH"));

  const noOp = planRuntimeBreakGlassTransition({
    incident: rawApproved,
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: { ...patchEvidence, post_change_hashes: preChangeHashes(), post_change_readback_hashes: preChangeHashes() },
  });
  assert.equal(noOp.decision, "blocked");
  assert(noOp.blockers.includes("BREAK_GLASS_NO_OP_PATCH_FORBIDDEN"));

  const staleBaseline = planRuntimeBreakGlassTransition({
    incident: rawApproved,
    to_state: "LOCAL_PATCH_APPLIED",
    evidence: { ...patchEvidence, pre_change_readback_hashes: preChangeHashes({ [pathB]: "f".repeat(64) }) },
  });
  assert.equal(staleBaseline.decision, "blocked");
  assert(staleBaseline.blockers.includes("BREAK_GLASS_PRE_CHANGE_READBACK_MISMATCH"));
}

{
  const applied = approved(incident({
    lifecycle_state: "LOCAL_PATCH_APPLIED",
    post_change_hashes: postChangeHashes(),
    post_change_readback_hashes: postChangeHashes(),
    local_patch_applied_at: patchAppliedAt,
  }));
  const evidence = { runtime_verification_run_id: uuidD, runtime_verification: verifiedRuntime() };

  const syncResult = planRuntimeBreakGlassTransition({ incident: applied, to_state: "RUNTIME_VERIFIED", evidence });
  assert.equal(syncResult.decision, "blocked");
  assert(syncResult.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_LOOKUP_REQUIRED"));
  assert(syncResult.blockers.includes("BREAK_GLASS_RUNTIME_READBACK_AUTHORITY_LOOKUP_REQUIRED"));

  const verified = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async (runId) => runId === uuidD ? verifiedRun() : null },
   );
  assert.equal(verified.decision, "eligible_shadow");
  assert.equal(verified.event_preview.evidence.control_plane_run.run_status, "verified");
  assert.equal(verified.event_preview.evidence.control_plane_run.production_parity, "verified");
  assert.equal(verified.event_preview.evidence.run_bound_readback.surface_key, "runtime_break_glass_file_readback");

  const missing = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => null, loadRuntimeVerificationReadback: async () => runReadback() },
  );
  assert.equal(missing.decision, "blocked");
  assert(missing.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_NOT_FOUND"));

  const degraded = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ run_status: "degraded", production_parity: "degraded" }) },
  );
  assert.equal(degraded.decision, "blocked");
  assert(degraded.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_NOT_VERIFIED"));
  assert(degraded.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_PARITY_NOT_VERIFIED"));

  const wrongCommit = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ deployed_commit_sha: "f".repeat(40) }) },
  );
  assert.equal(wrongCommit.decision, "blocked");
  assert(wrongCommit.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_DEPLOYED_COMMIT_MISMATCH"));

  const wrongEnvironment = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ environment_key: "staging" }) },
  );
  assert.equal(wrongEnvironment.decision, "blocked");
  assert(wrongEnvironment.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_ENVIRONMENT_MISMATCH"));

  const blockingGap = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ gaps: [{ blocks_production_parity: 1 }] }) },
  );
  assert.equal(blockingGap.decision, "blocked");
  assert(blockingGap.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_BLOCKING_GAP"));

  const staleRun = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ started_at: prePatchRunStartedAt }) },
  );
  assert.equal(staleRun.decision, "blocked");
  assert(staleRun.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_PREDATES_PATCH"));

  const sameSecondPatchAt = new Date(patchAppliedAt);
  sameSecondPatchAt.setMilliseconds(500);
  const sameSecondRunAt = new Date(sameSecondPatchAt);
  sameSecondRunAt.setMilliseconds(0);
  const sameSecondApplied = { ...applied, local_patch_applied_at: sameSecondPatchAt.toISOString() };
  const ambiguousRun = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: sameSecondApplied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ started_at: sameSecondRunAt.toISOString() }) },
  );
  assert.equal(ambiguousRun.decision, "blocked");
  assert(ambiguousRun.blockers.includes("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_ORDER_AMBIGUOUS"));

  const inventedReadback = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: applied, to_state: "RUNTIME_VERIFIED", evidence },
    { loadRuntimeVerificationRun: async () => verifiedRun({ runtime_break_glass_readback: runReadback({ readback_hashes: postChangeHashes({ [pathB]: "f".repeat(64) }) }) }) },
  );
  assert.equal(inventedReadback.decision, "blocked");
  assert(inventedReadback.blockers.includes("BREAK_GLASS_RUNTIME_READBACK_HASH_MISMATCH"));
}

{
  const persistedVerification = verifiedRuntime();
  const runtimeVerified = approved(incident({
    lifecycle_state: "RUNTIME_VERIFIED",
    post_change_hashes: postChangeHashes(),
    post_change_readback_hashes: postChangeHashes(),
    local_patch_applied_at: patchAppliedAt,
    runtime_verification_run_id: uuidD,
    runtime_verification: persistedVerification,
  }));
  const reconcile = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: runtimeVerified, to_state: "RECONCILING" },
    { loadRuntimeVerificationRun: async () => verifiedRun() },
  );
  assert.equal(reconcile.decision, "eligible_shadow");

  const reboundRun = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: runtimeVerified, to_state: "RECONCILING", evidence: { runtime_verification_run_id: uuidE } },
    { loadRuntimeVerificationRun: async () => verifiedRun() },
  );
  assert.equal(reboundRun.decision, "blocked");
  assert(reboundRun.blockers.includes("BREAK_GLASS_RUNTIME_VERIFICATION_RUN_REBIND_FORBIDDEN"));

  const revoked = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: { ...runtimeVerified, runtime_policy_ready: false }, to_state: "RECONCILING" },
    { loadRuntimeVerificationRun: async () => verifiedRun() },
  );
  assert.equal(revoked.decision, "blocked");
  assert(revoked.blockers.includes("BREAK_GLASS_RUNTIME_POLICY_NOT_READY"));

  const laterPhase = planRuntimeBreakGlassTransition({ incident: incident({ lifecycle_state: "RECONCILING" }), to_state: "MAIN_COMMITTED" });
  assert.equal(laterPhase.decision, "blocked");
  assert(laterPhase.blockers.includes("BREAK_GLASS_FOLLOWUP_PHASE_REQUIRED"));
}

{
  const rollbackIncident = approved(incident({ lifecycle_state: "LOCAL_PATCH_APPLIED", authorization_expires_at: past, runtime_policy_ready: false }));
  const rollback = planRuntimeBreakGlassTransition({
    incident: rollbackIncident,
    to_state: "ROLLED_BACK",
    evidence: {
      rollback_applied: true,
      rollback_readback_verified: true,
      rollback_readback_hashes: preChangeHashes(),
      secrets_included: false,
    },
  });
  assert.equal(rollback.decision, "eligible_shadow");
  assert(rollback.incident_update_preview.rolled_back_at);

  const driftedRollbackIncident = {
    ...rollbackIncident,
    pre_change_hashes: preChangeHashes({ [pathA]: "f".repeat(64) }),
  };
  const driftedRollback = planRuntimeBreakGlassTransition({
    incident: driftedRollbackIncident,
    to_state: "ROLLED_BACK",
    evidence: {
      rollback_applied: true,
      rollback_readback_verified: true,
      rollback_readback_hashes: preChangeHashes({ [pathA]: "f".repeat(64) }),
      secrets_included: false,
    },
  });
  assert.equal(driftedRollback.decision, "blocked");
  assert(driftedRollback.blockers.includes("BREAK_GLASS_APPROVED_SCOPE_MISMATCH"));
}

const migration = readFileSync("migrations/20260810_runtime_break_glass_lifecycle_v1.sql", "utf8");
assert(migration.includes("target_application_root VARCHAR(1024) NOT NULL"));
assert(migration.includes("approved_scope_sha256 CHAR(64) NULL"));
assert(migration.includes("UNIQUE KEY uq_runtime_break_glass_identity_pair (break_glass_id, incident_id)"));
assert(migration.includes("FOREIGN KEY (break_glass_id, incident_id) REFERENCES runtime_break_glass_incidents (break_glass_id, incident_id)"));
assert.equal((migration.match(/CHECK\s*\(\s*secrets_included\s*=\s*0\s*\)/gi) || []).length, 2);
assert(!/\bDROP\s+TABLE\b/i.test(migration));
assert(!/\bTRUNCATE\b/i.test(migration));
assert(!/\bDELETE\s+FROM\b/i.test(migration));
assert(!/^\s*UPDATE\s+[a-z_]/im.test(migration));
assert(!/\bINSERT\s+INTO\b/i.test(migration));

console.log("Spec018 runtime break-glass lifecycle D01-D06 tests passed");
