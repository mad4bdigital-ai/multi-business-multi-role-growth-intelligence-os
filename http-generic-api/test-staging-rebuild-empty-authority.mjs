import assert from "node:assert/strict";
import test from "node:test";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { createStagingRebuildEmptyAuthority, _testingStagingRebuildEmptyAuthority } from "./stagingRebuildEmptyAuthority.js";

const SHA = "a".repeat(40);
const DB_TARGET = "d".repeat(64);
const CONTROL_TARGET = "c".repeat(64);
const MANIFEST_HASH = "1".repeat(64);
const ATTESTATION_HASH = "2".repeat(64);

function bundle(role, seed) {
  return buildRoleBundleBinding({
    role,
    bundleManifestSha256: MANIFEST_HASH,
    roleBundleSha256: seed.repeat(64),
    statementCount: 1,
    statementFingerprints: [String(Number.parseInt(seed, 16) + 3).toString(16).slice(-1).repeat(64)],
  });
}

function counts(tables = 0) {
  return { tables, views: 0, triggers: 0, routines: 0, events: 0, total: tables };
}

function inspectionEnvelope({ correlation = "staging-authority-test-001", tamperRole = null } = {}) {
  const roleCounts = {
    runtime: counts(782),
    governance: counts(0),
    runtime_persistence: counts(0),
  };
  const fingerprints = Object.fromEntries(Object.entries(roleCounts).map(([role, value]) => [role, _testingStagingRebuildEmptyAuthority.objectCountsFingerprint(value)]));
  if (tamperRole) fingerprints[tamperRole] = "e".repeat(64);
  return {
    expected_sha: SHA,
    target_key: "staging-runtime",
    correlation_id: correlation,
    inspection: {
      contract: "mad4b.staging-local-full-inspection.v2",
      full_inspection: true,
      database_target_fingerprint: DB_TARGET,
      database_target_fingerprint_source: "runtime_bootstrap_target_binding",
      role_database_object_counts: roleCounts,
      role_database_object_classifications: { runtime: "nonempty_objects", governance: "zero_objects", runtime_persistence: "zero_objects" },
      role_database_object_count_fingerprints: fingerprints,
      read_only_probe: true,
      database_connection_performed: true,
      database_mutation_performed: false,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      workflow_dispatch_performed: false,
      production_accessed: false,
      secrets_included: false,
    },
    role_bundle_bindings: {
      governance: bundle("governance", "4"),
      runtime_persistence: bundle("runtime_persistence", "5"),
    },
  };
}

function harness() {
  const runs = new Map();
  const findings = new Map();
  const plans = new Map();
  const approvals = new Map();
  const approvalIndex = new Map();
  const approvalReservations = new Map();
  const tickets = new Map();
  let controlTarget = CONTROL_TARGET;

  const store = {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    shared_replica_safe: true,
    schema_auto_apply: false,
    provider_accessed: false,
    payload_integrity_verified_on_read: true,
    executionTicketVerifier: { async verify() { return true; } },
    async getReadiness() { return { contract: "mad4b.recovery-control-store-readiness.v1", ready: true, scope: "durable_inspection", database_mutation_performed: false, schema_auto_apply: false, secrets_included: false }; },
    async putRun(value) { runs.set(value.run_id, structuredClone(value)); },
    async getRun(id) { return runs.has(id) ? structuredClone(runs.get(id)) : null; },
    async putFinding(value) { findings.set(value.finding_id, structuredClone(value)); },
    async getFinding(id) { return findings.has(id) ? structuredClone(findings.get(id)) : null; },
    async putPlan(value) { plans.set(value.plan_id, structuredClone(value)); },
    async getPlan(id) { return plans.has(id) ? structuredClone(plans.get(id)) : null; },
    async putApproval(value) { approvals.set(value.approval_id, structuredClone(value)); approvalIndex.set(`${value.plan_id}:${value.step_id}`, value.approval_id); },
    async getApprovalByPlanStep(planId, stepId) { const id = approvalIndex.get(`${planId}:${stepId}`); return id ? structuredClone(approvals.get(id)) : null; },
    async reserveApproval(value) {
      const key = `${value.approval_id}:${value.plan_hash}:${value.step_id}`;
      const existing = approvalReservations.get(key);
      if (existing) return { reserved: false, existing: true, same_idempotency: existing.idempotency_key === value.idempotency_key };
      approvalReservations.set(key, structuredClone(value));
      return { reserved: true };
    },
    async releaseApprovalReservation(value) {
      for (const [key, entry] of approvalReservations.entries()) if (entry.approval_id === value.approval_id && entry.idempotency_key === value.idempotency_key) approvalReservations.delete(key);
      return { released: true };
    },
    async markApprovalUsed(id) { const value = approvals.get(id); if (!value) return { already_finalized: true }; approvals.set(id, { ...value, used: true }); return { finalized: true }; },
    async putExecutionTicket(value) { const existing = tickets.get(value.ticket_id); if (existing && existing.ticket_hash !== value.ticket_hash) throw new Error("ticket collision"); tickets.set(value.ticket_id, structuredClone(value)); },
    async getExecutionTicket(id) { return tickets.has(id) ? structuredClone(tickets.get(id)) : null; },
    async getRunByIdempotency() { return null; },
    async appendEvidenceEvent() {},
    async putIdempotencyReceipt() {},
    async claimExecution() { return { claimed: true }; },
    async reserveExecutionTicket() { return { reserved: true }; },
    async releaseExecutionTicket() { return { released: true }; },
    async finalizeExecutionTicket() { return { finalized: true }; },
    async releaseExecutionClaim() { return { released: true }; },
    async finalizeApproval({ approval_id: id } = {}) { return this.markApprovalUsed(id); },
  };

  const graph = {
    recoveryStore: store,
    deploymentIdentityProvider: {
      async readAttestation() {
        return {
          repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
          branch: "main",
          environment: "staging",
          sha: SHA,
          target_fingerprint: controlTarget,
          manifest_bound: true,
          recovery_manifest_hash: MANIFEST_HASH,
          attestation_hash: ATTESTATION_HASH,
          secrets_included: false,
        };
      },
    },
    approvalIssuer: { async createChallenge() { return { authority: "server_managed", expires_at: new Date(Date.now() + 300000).toISOString(), server_token: "server-token-for-authority-test" }; } },
    approvalVerifier: { async verify() { return true; } },
    approvalStore: { async putChallenge() {}, async getChallenge() { return null; } },
    executionTicketSigner: { async sign() { return "authority-test-signature"; } },
  };
  return {
    authority: createStagingRebuildEmptyAuthority({ authorityGraph: graph }),
    store,
    setControlTarget(value) { controlTarget = value; },
  };
}

test("mixed topology selects only empty roles through canonical Recovery Kernel findings", async () => {
  const h = harness();
  const recorded = await h.authority.recordInspection(inspectionEnvelope());
  assert.deepEqual(recorded.selected_zero_object_roles, ["governance", "runtime_persistence"]);
  assert.deepEqual(recorded.selected_capability_keys, ["governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty"]);
  assert.deepEqual(recorded.preserved_nonempty_roles, ["runtime"]);
  assert.equal(recorded.canonical_finding_classifier, "RecoveryKernel.findingsFromInspection");
  assert.equal(recorded.target_fingerprint, DB_TARGET);
  assert.equal(recorded.control_plane_target_fingerprint, CONTROL_TARGET);
  assert.notEqual(recorded.target_fingerprint, recorded.control_plane_target_fingerprint);
  const run = await h.store.getRun(recorded.inspection_run_id);
  assert.deepEqual(run.findings.map((finding) => finding.candidate_capability).sort(), ["governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty"]);
  const proof = await h.authority.resolveProof({ expected_sha: SHA, target_key: "staging-runtime", inspection_run_id: recorded.inspection_run_id });
  assert.equal(proof.composite_target_fingerprint, DB_TARGET);
  assert.deepEqual(proof.selected_roles, ["governance", "runtime_persistence"]);
});

test("server rejects a structurally valid but non-canonical object-count fingerprint before durable planning", async () => {
  const h = harness();
  await assert.rejects(() => h.authority.recordInspection(inspectionEnvelope({ correlation: "staging-authority-test-tamper", tamperRole: "governance" })), (error) => error?.code === "STAGING_REBUILD_EMPTY_INSPECTION_FINGERPRINT_MISMATCH");
});

test("prepare is deterministic and emits one canonical remediation plan per selected role", async () => {
  const h = harness();
  const recorded = await h.authority.recordInspection(inspectionEnvelope({ correlation: "staging-authority-test-plan" }));
  const first = await h.authority.prepare({ expected_sha: SHA, inspection_run_id: recorded.inspection_run_id, idempotency_key: "staging-authority-idempotency-001" });
  const second = await h.authority.prepare({ expected_sha: SHA, inspection_run_id: recorded.inspection_run_id, idempotency_key: "staging-authority-idempotency-001" });
  assert.equal(first.approval_set_hash, second.approval_set_hash);
  assert.equal(first.approval_confirmation, second.approval_confirmation);
  assert.equal(first.target_fingerprint, DB_TARGET);
  assert.equal(first.control_plane_target_fingerprint, CONTROL_TARGET);
  assert.equal(first.role_plans.length, 2);
  assert.deepEqual(first.role_plans, second.role_plans);
  assert.deepEqual(first.role_plans.map((plan) => plan.capability_key).sort(), ["governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty"]);
  for (const rolePlan of first.role_plans) {
    assert.equal(rolePlan.idempotency_key, `staging-authority-idempotency-001:${rolePlan.role}`);
    const persisted = await h.store.getPlan(rolePlan.plan_id);
    assert.equal(persisted.contract, "mad4b.recovery-remediation-plan.v1");
    assert.equal(persisted.steps.length, 1);
    assert.equal(persisted.steps[0].capability_key, `${rolePlan.role}.baseline.rebuild_empty`);
    assert.deepEqual(persisted.role_selection_proof.selected_roles, [rolePlan.role]);
  }
});

test("approval retry returns the same persisted role-specific single-use tickets", async () => {
  const h = harness();
  const recorded = await h.authority.recordInspection(inspectionEnvelope({ correlation: "staging-authority-test-approve" }));
  const prepared = await h.authority.prepare({ expected_sha: SHA, inspection_run_id: recorded.inspection_run_id, idempotency_key: "staging-authority-idempotency-approve" });
  const input = { expected_sha: SHA, inspection_run_id: recorded.inspection_run_id, idempotency_key: "staging-authority-idempotency-approve", approval_confirmation: prepared.approval_confirmation };
  const first = await h.authority.approveAndIssue(input);
  const second = await h.authority.approveAndIssue(input);
  assert.equal(first.status, "role_execution_tickets_issued");
  assert.equal(first.role_issuances.length, 2);
  assert.deepEqual(first.role_issuances.map((entry) => [entry.target_role, entry.execution_ticket_id, entry.execution_ticket_hash]), second.role_issuances.map((entry) => [entry.target_role, entry.execution_ticket_id, entry.execution_ticket_hash]));
  assert.deepEqual(first.selected_capability_keys.sort(), ["governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty"]);
  for (const issuance of first.role_issuances) {
    assert.equal(issuance.canonical_capability_key, `${issuance.target_role}.baseline.rebuild_empty`);
    assert.deepEqual(issuance.selected_zero_object_roles, [issuance.target_role]);
    assert.deepEqual(issuance.role_selection_proof.selected_roles, [issuance.target_role]);
    assert.equal(issuance.target_fingerprint, DB_TARGET);
  }
  await assert.rejects(() => h.authority.approveAndIssue({ ...input, idempotency_key: "different-idempotency-key" }), (error) => error?.code === "RECOVERY_APPROVAL_INVALID");
});

test("role-ticket issuance rejects an approval reservation owned by another idempotency key", async () => {
  const h = harness();
  const recorded = await h.authority.recordInspection(inspectionEnvelope({ correlation: "staging-authority-test-foreign-reservation" }));
  const prepared = await h.authority.prepare({ expected_sha: SHA, inspection_run_id: recorded.inspection_run_id, idempotency_key: "staging-authority-idempotency-owner" });
  const rolePlan = prepared.role_plans[0];
  const plan = await h.store.getPlan(rolePlan.plan_id);
  const step = plan.steps[0];
  const approval = await h.store.getApprovalByPlanStep(plan.plan_id, step.step_id);
  const foreign = await h.store.reserveApproval({
    approval_id: approval.approval_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    idempotency_key: "foreign-idempotency-owner",
  });
  assert.equal(foreign.reserved, true);
  await assert.rejects(
    () => h.authority.approveAndIssue({
      expected_sha: SHA,
      inspection_run_id: recorded.inspection_run_id,
      idempotency_key: "staging-authority-idempotency-owner",
      approval_confirmation: prepared.approval_confirmation,
    }),
    (error) => error?.code === "RECOVERY_APPROVAL_INVALID" && error?.status === 409,
  );
});

test("durable role-selection proof is invalidated if Recovery control-plane identity changes", async () => {
  const h = harness();
  const recorded = await h.authority.recordInspection(inspectionEnvelope({ correlation: "staging-authority-test-control-plane" }));
  h.setControlTarget("9".repeat(64));
  await assert.rejects(() => h.authority.resolveProof({ expected_sha: SHA, target_key: "staging-runtime", inspection_run_id: recorded.inspection_run_id }), (error) => error?.code === "RECOVERY_TICKET_BINDING_MISMATCH");
});
