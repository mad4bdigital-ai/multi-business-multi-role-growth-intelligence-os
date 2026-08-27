import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_ORDER_CONTRACT,
  buildApprovalBinding,
  buildBaselineExecutionOrderProof,
  buildRoleBundleBinding,
  createRoleBundleProgress,
  recordRoleBundleProgress,
  validateApprovalBinding,
  validateBaselineBeforeOrdinaryMigration,
  validateDeploymentIdentityAttestation,
  validateDurableRunReference,
  validateExecutionLifecycleOrder,
  validateRoleBundleBinding,
  resolveRuntimeMigrationTargetBinding,
} from "./recoveryExecutionBinding.js";

const SHA = "a".repeat(40);
const MANIFEST_HASH = "b".repeat(64);
const ATTESTATION_HASH = "c".repeat(64);
const TARGET = "d".repeat(64);
const COMPLETE_STAGES = [
  "recovery_control_plane_ready",
  "durable_full_inspection",
  "governance_baseline_ready",
  "runtime_persistence_baseline_ready",
  "canonical_grants_readback_ready",
  "governance_authority_ready",
];

function validAttestation(overrides = {}) {
  return {
    contract: "mad4b.recovery-runtime-attestation.v1",
    deployment_identity_contract: "mad4b.recovery-deployment-identity-attestation.v1",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    repository_sha: SHA,
    deployment_sha: SHA,
    recovery_manifest_hash: MANIFEST_HASH,
    manifest_bound: true,
    read_only_probe: true,
    attestation_hash: ATTESTATION_HASH,
    target_fingerprint: TARGET,
    target_fingerprints: { composite: TARGET, governance: TARGET },
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

test("deployment identity attestation binds repository, branch, exact SHA, manifest, target and read-only state", () => {
  const result = validateDeploymentIdentityAttestation({
    attestation: validAttestation(),
    expectedSha: SHA,
    expectedRepository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    expectedBranch: "Production",
    expectedManifestHash: MANIFEST_HASH,
    expectedAttestationHash: ATTESTATION_HASH,
    expectedTargetFingerprint: TARGET,
    expectedTargetRole: "governance",
  });
  assert.equal(result.ok, true);
  assert.equal(result.binding.target_role, "governance");
  assert.equal(result.secrets_included, false);
});

test("deployment identity mismatch fails closed without treating attestation as authority", () => {
  const result = validateDeploymentIdentityAttestation({
    attestation: validAttestation({ deployment_sha: "e".repeat(40), database_mutation_performed: true }),
    expectedSha: SHA,
    expectedRepository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    expectedBranch: "Production",
    expectedManifestHash: MANIFEST_HASH,
    expectedAttestationHash: ATTESTATION_HASH,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes("deployment_sha_mismatch"));
  assert.ok(result.problems.includes("database_mutation_attestation_invalid"));
});

test("ordinary migration requires a complete, hash-bound baseline predecessor proof", () => {
  const proof = buildBaselineExecutionOrderProof({ expectedSha: SHA, targetKey: "production-runtime", completedStages: COMPLETE_STAGES });
  const accepted = validateBaselineBeforeOrdinaryMigration({ proof, expectedSha: SHA, targetKey: "production-runtime" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.contract, BASELINE_ORDER_CONTRACT.contract);

  const missing = validateBaselineBeforeOrdinaryMigration({
    proof: buildBaselineExecutionOrderProof({ expectedSha: SHA, targetKey: "production-runtime", completedStages: COMPLETE_STAGES.slice(0, -1) }),
    expectedSha: SHA,
    targetKey: "production-runtime",
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((problem) => problem.includes("governance_authority_ready")));
});

test("role bundle progress is exact-bound, monotonic, and reconciliation-first on partial execution", () => {
  const binding = buildRoleBundleBinding({ role: "governance", bundleManifestSha256: "1".repeat(64), roleBundleSha256: "2".repeat(64), statementCount: 2, statementFingerprints: ["3".repeat(64), "4".repeat(64)] });
  assert.equal(validateRoleBundleBinding(binding, { role: binding.role, bundleManifestSha256: binding.bundle_manifest_sha256, roleBundleSha256: binding.role_bundle_sha256, statementCount: binding.statement_count, statementFingerprints: binding.statement_fingerprints }).ok, true);
  let progress = createRoleBundleProgress({ role: "governance", bundleBinding: binding });
  progress = recordRoleBundleProgress(progress, { state: "executing", completedBoundary: 1, providerOutcome: "acknowledged" });
  assert.deepEqual(progress.completed_boundaries, [1]);
  progress = recordRoleBundleProgress(progress, { state: "partial_execution", completedBoundary: 1, providerOutcome: "unknown", reconciliationRequired: true });
  assert.equal(progress.reconciliation_required, true);
  assert.equal(progress.automatic_rerun_allowed, false);
  assert.throws(() => recordRoleBundleProgress(progress, { state: "executing", completedBoundary: 2 }), /regress/u);
});

test("role bundle binding rejects checksum, statement count, and role tampering", () => {
  const binding = buildRoleBundleBinding({ role: "governance", bundleManifestSha256: "5".repeat(64), roleBundleSha256: "6".repeat(64), statementCount: 1, statementFingerprints: ["7".repeat(64)] });
  const result = validateRoleBundleBinding({ ...binding, role_bundle_sha256: "8".repeat(64) }, binding);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes("role_bundle_role_bundle_sha256_mismatch"));
});

test("runtime migration separates governance ownership from runtime database target role", () => {
  const accepted = resolveRuntimeMigrationTargetBinding({ migration: "20260815_custom_gpt_mcp_catalog_levels.sql", ownershipDomain: "governance", databaseTargetRole: "runtime" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.ownership_domain, "governance");
  assert.equal(accepted.database_target_role, "runtime");
  const rejected = resolveRuntimeMigrationTargetBinding({ migration: "20260815_custom_gpt_mcp_catalog_levels.sql", ownershipDomain: "governance", databaseTargetRole: "governance" });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.problems.includes("migration_database_target_role_mismatch"));
});

test("single-step approval binding is cryptographically target-bound and tamper-evident", () => {
  const fields = { approvalId: "approval:test-approval-001", approvalHash: "8".repeat(64), approvalVersion: "v1", planHash: "9".repeat(64), stepId: "step:test-step-001", stepHash: "a".repeat(64), targetKey: "production-runtime", targetFingerprint: "b".repeat(64), targetRole: "runtime", operation: "apply_migration" };
  const binding = buildApprovalBinding(fields);
  assert.equal(validateApprovalBinding(binding, fields).ok, true);
  const tampered = validateApprovalBinding({ ...binding, target_fingerprint: "c".repeat(64) }, fields);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.problems.includes("approval_target_fingerprint_mismatch"));
});

test("durable run reference requires the exact run id and denies memory fallback", () => {
  const run = { run_id: "run:durable-run-001", plan_hash: "d".repeat(64), step_id: "step:test-step-001" };
  const accepted = validateDurableRunReference({ runId: run.run_id, run, planHash: run.plan_hash, stepId: run.step_id });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.in_memory_fallback_allowed, false);
  const rejected = validateDurableRunReference({ runId: "run:other-run-001", run, planHash: run.plan_hash, stepId: run.step_id });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.problems.includes("run_id_mismatch"));
});

test("execute-and-verify lifecycle requires readback before finalization", () => {
  const valid = validateExecutionLifecycleOrder(["provider_acknowledged", "readback_pending", "verifying", "verified", "recovered"]);
  assert.equal(valid.ok, true);
  const invalid = validateExecutionLifecycleOrder(["provider_acknowledged", "verified", "verifying", "recovered"]);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.problems.includes("lifecycle_phase_order_invalid"));
});

console.log("recovery execution binding contract tests loaded");
