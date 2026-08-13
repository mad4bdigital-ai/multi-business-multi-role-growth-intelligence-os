import assert from "node:assert/strict";
import fs from "node:fs";

import {
  RUNTIME_BREAK_GLASS_OPERATION_INTENT,
  planRuntimeBreakGlassTransitionWithControlPlane,
} from "./runtimeBreakGlassLifecycle.js";
import {
  buildRuntimeBreakGlassApprovalScope,
  fingerprintRuntimeBreakGlassApprovalScope,
  parseRuntimeBreakGlassScopeJson,
} from "./runtimeBreakGlassScopeBinding.js";
import {
  recordRuntimeBreakGlassVerificationReadback,
  RUNTIME_BREAK_GLASS_READBACK_SURFACE,
} from "./runtimeBreakGlassVerificationReadbackService.js";
import {
  buildRuntimeBreakGlassEnvelopeBinding,
  decorateRuntimeBreakGlassDryRun,
  RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
  RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
  RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
  RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT,
} from "./scripts/runtime-break-glass-capability-envelope-create.mjs";

const breakGlassId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const envelopeId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const commitSha = "a".repeat(40);
const preHash = "b".repeat(64);
const postHash = "c".repeat(64);
const applicationRoot = "/home/u123/domains/auth.mad4b.com/nodejs";
const exactPath = `${applicationRoot}/routes/runtime.js`;
const now = new Date();
const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
const envelopeFuture = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
const patchAt = new Date(now.getTime() - 20 * 1000).toISOString();
const runStartedAt = new Date(now.getTime() - 10 * 1000).toISOString();
const runCompletedAt = new Date(now.getTime() - 5 * 1000).toISOString();

function incident(overrides = {}) {
  return {
    break_glass_id: breakGlassId,
    incident_id: "INC-2026-08-11-PRODUCER",
    target_id: targetId,
    target_application_root: applicationRoot,
    environment_key: "production",
    lifecycle_state: "OPEN",
    approving_principal: "platform-admin:mad4bdigital-ai",
    executing_principal: "agent:runtime-recovery",
    capability_envelope_id: envelopeId,
    expected_commit_sha: commitSha,
    reason: "Emergency bounded runtime correction with exact governed producer evidence.",
    allowed_paths: [exactPath],
    pre_change_hashes: [{ path: exactPath, sha256: preHash }],
    rollback_plan: { strategy: "restore_pre_change_bytes", evidence_ref: "incident://rollback/producer" },
    audit_correlation: { correlation_id: "audit-break-glass-producer", incident_ref: "INC-2026-08-11-PRODUCER" },
    runtime_policy_ready: true,
    authorization_expires_at: future,
    ...overrides,
  };
}

// The issuer's canonical fingerprint must be byte-for-byte compatible with the
// existing lifecycle consumer. A drift in field selection or normalization
// makes this real planner transition fail closed.
{
  const raw = incident();
  const scope = buildRuntimeBreakGlassApprovalScope(raw);
  const scopeSha256 = fingerprintRuntimeBreakGlassApprovalScope(raw);
  assert.equal(scope.operation_intent, RUNTIME_BREAK_GLASS_OPERATION_INTENT);
  assert.match(scopeSha256, /^[0-9a-f]{64}$/);

  const planned = await planRuntimeBreakGlassTransitionWithControlPlane(
    { incident: raw, to_state: "APPROVED" },
    {
      loadCapabilityEnvelopeAuthority: async () => ({
        envelope_id: envelopeId,
        envelope_status: "ready_for_dispatch",
        dispatch_allowed: true,
        apply_allowed: true,
        approval_required: false,
        blocking_gap_count: 0,
        execution_status: "not_executed",
        expires_at: envelopeFuture,
        operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
        expected_commit_sha: commitSha,
        scope_sha256: scopeSha256,
        secrets_included: false,
      }),
    },
  );
  assert.equal(planned.decision, "eligible_shadow");
  assert.equal(planned.incident_update_preview.approved_scope_sha256, scopeSha256);
}

// Governed issuance computes the hash, fixes app/capability/runtime/commit, and
// requires a critical dry-run that is dispatchable but still approval/apply gated.
{
  const raw = incident();
  assert.throws(
    () => parseRuntimeBreakGlassScopeJson(JSON.stringify({ ...raw, runtime_break_glass_scope_sha256: "f".repeat(64) })),
    (error) => error.code === "runtime_break_glass_scope_fingerprint_caller_supplied",
  );
  assert.throws(
    () => parseRuntimeBreakGlassScopeJson(JSON.stringify({ ...raw, approved_scope_sha256: "f".repeat(64) })),
    (error) => error.code === "runtime_break_glass_scope_post_approval_evidence_forbidden",
  );

  const binding = buildRuntimeBreakGlassEnvelopeBinding(raw, ["--tenant-id", "tenant-1"], { ttlMinutes: 120, now });
  assert.equal(binding.scope_sha256, fingerprintRuntimeBreakGlassApprovalScope(raw));
  assert.deepEqual(binding.passthrough.slice(-10), [
    "--app-key", RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
    "--capability-key", RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
    "--operation-intent", RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT,
    "--runtime-surface", RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
    "--expected-commit-sha", commitSha,
  ]);
  assert.throws(
    () => buildRuntimeBreakGlassEnvelopeBinding(raw, ["--app-key", "github"], { ttlMinutes: 120, now }),
    (error) => error.code === "runtime_break_glass_authority_flag_override_forbidden",
  );
  assert.throws(
    () => buildRuntimeBreakGlassEnvelopeBinding(raw, [], { ttlMinutes: 5, now }),
    (error) => error.code === "runtime_break_glass_scope_exceeds_envelope_ttl",
  );

  const decorated = decorateRuntimeBreakGlassDryRun({
    request_context: { operation_intent: RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT },
    capability: {
      app_key: RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
      capability_key: RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
      risk_class: "critical",
      expected_commit_sha: commitSha,
    },
    selected_source: {
      selected_source_tier: "tenant_managed",
      selected_runtime_surface: RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
      active_credential_binding_count: 1,
      credential_source_candidates: ["mixed"],
    },
    authority: { status: "passed" },
    gates: {
      dispatch_allowed: true,
      apply_allowed: false,
      approval_required: true,
      audit_required: true,
      readback_required: true,
    },
    blocking_gaps: [],
    decision: "ready_requires_approval",
    inputs: {},
    secrets_included: false,
  }, binding);
  assert.equal(decorated.request_context.operation_intent, RUNTIME_BREAK_GLASS_OPERATION_INTENT);
  assert.equal(decorated.request_context.runtime_break_glass_scope_sha256, binding.scope_sha256);
  assert.equal(decorated.authority.runtime_break_glass_scope_sha256, binding.scope_sha256);
  assert.equal(decorated.capability.risk_class, "critical");
  assert.equal(decorated.gates.approval_required, true);
  assert.equal(decorated.gates.apply_allowed, false);

  assert.throws(
    () => decorateRuntimeBreakGlassDryRun({
      request_context: { operation_intent: RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT },
      capability: { app_key: RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY, capability_key: RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY, risk_class: "low" },
      selected_source: { selected_runtime_surface: RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE },
      gates: { dispatch_allowed: true, apply_allowed: true, approval_required: false, audit_required: true, readback_required: true },
      blocking_gaps: [],
      decision: "ready_for_dispatch",
    }, binding),
    (error) => error.code === "runtime_break_glass_envelope_dry_run_not_approval_ready",
  );
}

// Keep persistence D01 structurally additive/no-DML, and isolate D03 authority
// registry metadata in its own unapplied migration source.
{
  const persistenceMigration = fs.readFileSync(new URL("./migrations/20260810_runtime_break_glass_lifecycle_v1.sql", import.meta.url), "utf8");
  assert.doesNotMatch(persistenceMigration, /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/im);

  const authorityMigration = fs.readFileSync(new URL("./migrations/20260811_runtime_break_glass_authority_metadata_v1.sql", import.meta.url), "utf8");
  assert.match(authorityMigration, /runtime_break_glass_bounded_file_patch_apply_policy_v1/);
  assert.match(authorityMigration, /remote_ssh\.exec_allowlisted/);
  assert.match(authorityMigration, /'runtime_break_glass_bounded_file_patch'/);
  assert.match(authorityMigration, /'critical'/);
  assert.match(authorityMigration, /'shadow_authority_registered'/);
  assert.match(authorityMigration, /caller_supplied_scope_fingerprint/);
  assert.match(authorityMigration, /runtime_mutation_route/);
}

function persistedIncident(overrides = {}) {
  const raw = incident({
    lifecycle_state: "LOCAL_PATCH_APPLIED",
    approved_scope_sha256: fingerprintRuntimeBreakGlassApprovalScope(incident()),
    post_change_hashes: [{ path: exactPath, sha256: postHash }],
    post_change_readback_hashes: [{ path: exactPath, sha256: postHash }],
    local_patch_applied_at: patchAt,
    ...overrides,
  });
  return {
    ...raw,
    allowed_paths_json: raw.allowed_paths,
    pre_change_hashes_json: raw.pre_change_hashes,
    rollback_plan_json: raw.rollback_plan,
    audit_correlation_json: raw.audit_correlation,
    post_change_hashes_json: raw.post_change_hashes,
    post_change_readback_json: raw.post_change_readback_hashes,
    secrets_included: 0,
  };
}

function verifiedRun(overrides = {}) {
  return {
    run_id: runId,
    environment_key: "production",
    expected_commit_sha: commitSha,
    deployed_commit_sha: commitSha,
    workflow_key: "runtime_verification_control_plane",
    run_status: "verified",
    production_parity: "verified",
    summary_json: { blocking_gap_count: 0 },
    started_at: runStartedAt,
    completed_at: runCompletedAt,
    ...overrides,
  };
}

function fakeConnection({ incidentRow = persistedIncident(), runRow = verifiedRun(), existingEvidence = [] } = {}) {
  const state = { insertedPayload: null, began: false, committed: false, rolledBack: false };
  return {
    state,
    async beginTransaction() { state.began = true; },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    async query(sql, params) {
      if (sql.includes("FROM runtime_break_glass_incidents")) return [[incidentRow]];
      if (sql.includes("FROM runtime_verification_runs")) return [[runRow]];
      if (sql.includes("FROM runtime_verification_evidence_chunks") && sql.includes("SELECT chunk_id")) return [existingEvidence];
      if (sql.includes("INSERT INTO runtime_verification_evidence_chunks")) {
        state.insertedPayload = JSON.parse(params[6]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

// Authoritative readback derives paths from the persisted incident, binds the
// selected verified run, and persists hashes only.
{
  const connection = fakeConnection();
  const result = await recordRuntimeBreakGlassVerificationReadback(
    { runId, breakGlassId, now },
    {
      connection,
      realpath: async (value) => value,
      hashFile: async (value, context) => {
        assert.equal(value, exactPath);
        assert.equal(context.declaredRoot, applicationRoot);
        assert.equal(context.realRoot, applicationRoot);
        return postHash;
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.matches_post_change_hashes, true);
  assert.equal(result.surface_key, RUNTIME_BREAK_GLASS_READBACK_SURFACE);
  assert.equal(result.file_contents_returned, false);
  assert.equal(result.hostinger_mutation_performed, false);
  assert.equal(connection.state.committed, true);
  assert.equal(connection.state.insertedPayload.run_id, runId);
  assert.equal(connection.state.insertedPayload.break_glass_id, breakGlassId);
  assert.equal(connection.state.insertedPayload.incident_id, persistedIncident().incident_id);
  assert.equal(connection.state.insertedPayload.approved_scope_sha256, persistedIncident().approved_scope_sha256);
  assert.deepEqual(connection.state.insertedPayload.readback_hashes, [{ path: exactPath, sha256: postHash }]);
  assert.equal(Object.hasOwn(connection.state.insertedPayload, "file_contents"), false);
}

{
  const duplicate = fakeConnection({ existingEvidence: [{ chunk_id: "existing" }] });
  await assert.rejects(
    recordRuntimeBreakGlassVerificationReadback(
      { runId, breakGlassId, now },
      { connection: duplicate, realpath: async (value) => value, hashFile: async () => postHash },
    ),
    (error) => error.code === "runtime_break_glass_readback_evidence_already_exists",
  );
  assert.equal(duplicate.state.rolledBack, true);
  assert.equal(duplicate.state.insertedPayload, null);

  const wrongCommit = fakeConnection({ runRow: verifiedRun({ expected_commit_sha: "f".repeat(40) }) });
  await assert.rejects(
    recordRuntimeBreakGlassVerificationReadback(
      { runId, breakGlassId, now },
      { connection: wrongCommit, realpath: async (value) => value, hashFile: async () => postHash },
    ),
    (error) => error.code === "runtime_break_glass_readback_expected_commit_mismatch",
  );
  assert.equal(wrongCommit.state.insertedPayload, null);

  const wrongEnvironment = fakeConnection({ runRow: verifiedRun({ environment_key: "staging" }) });
  await assert.rejects(
    recordRuntimeBreakGlassVerificationReadback(
      { runId, breakGlassId, now },
      { connection: wrongEnvironment, realpath: async (value) => value, hashFile: async () => postHash },
    ),
    (error) => error.code === "runtime_break_glass_readback_environment_mismatch",
  );
  assert.equal(wrongEnvironment.state.insertedPayload, null);
}

console.log("runtime break-glass authority producers: ok");
