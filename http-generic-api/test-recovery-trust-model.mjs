import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertTrustForMutation,
  buildCausalFindingGraph,
  deriveRoleTargetFingerprints,
  getRecoveryTrustModel,
  readRecoveryManifest,
  readRuntimeAttestation,
  verifyRecoveryManifest,
} from "./recoveryTrustModel.js";
import { readCanonicalDeploymentIdentity } from "./deploymentManifest.js";

const SHA = "a".repeat(40);
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const ENV = {
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_REF_NAME: "Production",
  GITHUB_SHA: SHA,
  DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: REPOSITORY, branch: "Production", commit_sha: SHA, source: "test_fixture", secrets_included: false }),
};

test("manifest is repository-owned, hash-addressed, and contains no secret material", () => {
  const manifest = readRecoveryManifest();
  assert.equal(manifest.repository, REPOSITORY);
  assert.equal(manifest.production_branch, "Production");
  assert.equal(manifest.manifest_hash.length, 64);
  assert.equal(manifest.secrets_included, false);
  assert.equal(manifest.safety.raw_commands_allowed, false);
  assert.equal(manifest.safety.raw_sql_allowed, false);
  assert.equal(manifest.durability.consequential_mutation_requires_injected_durable_store, true);
  assert.equal(manifest.durability.store_independence.independent_of_target_databases, true);
  assert.equal(manifest.durability.store_independence.target_database_binding, "forbidden");
  assert.equal(manifest.empty_database_reconstruction.all_roles_must_be_zero_objects, false);
  assert.equal(manifest.empty_database_reconstruction.partial_role_rebuild_allowed, true);
  assert.equal(manifest.empty_database_reconstruction.runtime_nonempty_preserved, true);
  assert.equal(manifest.empty_database_reconstruction.pre_mutation_zero_object_recheck_required, true);
  assert.equal(manifest.empty_database_reconstruction.sequential_role_execution, true);
  assert.deepEqual(manifest.empty_database_reconstruction.selected_role_enum, ["runtime", "governance", "runtime_persistence"]);
  assert.deepEqual(manifest.empty_database_reconstruction.object_kinds, ["tables", "views", "triggers", "routines", "events"]);
  assert.equal(manifest.execution_authority.production.status, "primary_governed_admin_path");
  assert.equal(manifest.execution_authority.production.control_plane_host, "auth.mad4b.com");
  assert.equal(manifest.execution_authority.production.local_connector_required, false);
  assert.equal(manifest.execution_authority.production.local_connector_fallback_allowed, false);
  assert.equal(manifest.execution_authority.staging.local_connector_status, "deferred");
  assert.equal(manifest.execution_authority.staging.local_connector_required, false);
  assert.deepEqual(manifest.execution_authority.deferred_scope, ["local_connector"]);
});

test("manifest verification requires exact runtime SHA and production binding", () => {
  const verified = verifyRecoveryManifest({ expectedSha: SHA, env: ENV });
  assert.equal(verified.ok, true);
  assert.equal(verified.sha_match, true);
  const wrongSha = verifyRecoveryManifest({ expectedSha: "b".repeat(40), env: ENV });
  assert.equal(wrongSha.ok, false);
  const wrongBranch = verifyRecoveryManifest({ expectedSha: SHA, env: { ...ENV, DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: REPOSITORY, branch: "main", commit_sha: SHA, source: "test_fixture", secrets_included: false }) } });
  assert.equal(wrongBranch.ok, false);
});

test("env-only identity remains diagnostic but cannot satisfy Recovery Manifest trust", () => {
  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF_NAME: "Production",
    GITHUB_SHA: SHA,
    DEPLOYMENT_MANIFEST_PATH: "__missing_recovery_deployment_manifest_for_test__.json",
  };
  const verified = verifyRecoveryManifest({ expectedSha: SHA, env });
  assert.equal(verified.repository_match, true);
  assert.equal(verified.branch_match, true);
  assert.equal(verified.sha_match, true);
  assert.equal(verified.manifest_bound, false);
  assert.equal(verified.ok, false);

  const attestation = readRuntimeAttestation({ env, expectedSha: SHA });
  assert.equal(attestation.deployment_identity_manifest_bound, false);
  assert.equal(attestation.manifest_bound, false);
  assert.equal(attestation.parity, false);
});

test("canonical deployment identity prefers manifest JSON and supports legacy commit JSON", () => {
  const legacySha = "b".repeat(40);
  const legacy = readCanonicalDeploymentIdentity({
    env: {
      DEPLOYMENT_COMMIT_JSON: JSON.stringify({ repository: REPOSITORY, branch: "Production", commit_sha: legacySha }),
    },
  });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.source, "env:DEPLOYMENT_COMMIT_JSON");
  assert.equal(legacy.repository, REPOSITORY);
  assert.equal(legacy.branch, "Production");
  assert.equal(legacy.sha, legacySha);
  assert.equal(legacy.manifest_bound, true);

  const preferred = readCanonicalDeploymentIdentity({
    env: {
      DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: REPOSITORY, branch: "Production", commit_sha: SHA }),
      DEPLOYMENT_COMMIT_JSON: JSON.stringify({ repository: "wrong/repo", branch: "main", commit_sha: legacySha }),
    },
  });
  assert.equal(preferred.ok, true);
  assert.equal(preferred.source, "env:DEPLOYMENT_MANIFEST_JSON");
  assert.equal(preferred.repository, REPOSITORY);
  assert.equal(preferred.branch, "Production");
  assert.equal(preferred.sha, SHA);
});

test("runtime attestation resolves manifest path through the same canonical identity source", () => {
  const dir = mkdtempSync(join(tmpdir(), "mad4b-recovery-identity-"));
  const manifestPath = join(dir, "deployment-manifest.json");
  try {
    writeFileSync(manifestPath, JSON.stringify({ repository: REPOSITORY, branch: "Production", commit_sha: SHA, secrets_included: false }));
    const env = {
      DEPLOYMENT_MANIFEST_PATH: manifestPath,
      DEPLOYMENT_ENVIRONMENT: "production",
      GITHUB_REPOSITORY: "wrong/repository",
      GITHUB_REF_NAME: "main",
      GITHUB_SHA: "1".repeat(40),
    };
    const attestation = readRuntimeAttestation({ env, expectedSha: SHA });
    assert.equal(attestation.parity, true);
    assert.equal(attestation.manifest_bound, true);
    assert.equal(attestation.repository, REPOSITORY);
    assert.equal(attestation.branch, "Production");
    assert.equal(attestation.deployment_sha, SHA);
    assert.equal(attestation.identity_source, manifestPath);
    assert.equal(attestation.deployment_identity_manifest_bound, true);

    const model = getRecoveryTrustModel({ env, expectedSha: SHA });
    assert.equal(model.ok, true);
    assert.equal(model.identity.repository, REPOSITORY);
    assert.equal(model.identity.branch, "Production");
    assert.equal(model.identity.sha, SHA);
    assert.equal(model.identity.source, manifestPath);
    assert.equal(model.identity.manifest_bound, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime attestation is hash-only and includes independent role target fingerprints", () => {
  const attestation = readRuntimeAttestation({ env: ENV, expectedSha: SHA });
  assert.equal(attestation.parity, true);
  assert.equal(attestation.manifest_bound, true);
  assert.equal(attestation.attestation_hash.length, 64);
  assert.equal(attestation.repository_sha, SHA);
  assert.equal(attestation.target_fingerprints.composite.length, 64);
  for (const role of ["runtime", "governance", "runtime_persistence"]) {
    assert.equal(attestation.role_credentials_ready[role].raw_values_exposed, false);
    assert.equal(attestation.role_credentials_ready[role].secrets_included, false);
    assert.equal(attestation.target_fingerprints[role].length, 64);
  }
});

test("mutation trust assertion rechecks target fingerprint and admin principal", () => {
  const fingerprints = deriveRoleTargetFingerprints({ env: ENV });
  const accepted = assertTrustForMutation({ expectedSha: SHA, env: ENV, targetRole: "governance", targetFingerprint: fingerprints.governance, adminPrincipal: { verified: true } });
  assert.equal(accepted.ok, true);
  assert.throws(() => assertTrustForMutation({ expectedSha: SHA, env: { ...ENV, GOVERNANCE_DB_USER: "changed-principal-only-for-test" }, targetRole: "governance", targetFingerprint: fingerprints.governance, adminPrincipal: { verified: true } }), (error) => error?.code === "TARGET_CHANGED");
  assert.throws(() => assertTrustForMutation({ expectedSha: SHA, env: ENV, targetRole: "governance", targetFingerprint: fingerprints.governance, adminPrincipal: { verified: false } }), (error) => error?.code === "RECOVERY_ADMIN_PRINCIPAL_REQUIRED");
});

test("causal finding graph records unknown drift without inventing a repair capability", () => {
  const graph = buildCausalFindingGraph([
    { finding_id: "finding:aaaaaaaaaaaaaaaa", category: "schema_drift", repairability: "deterministic", subject: { target_role: "runtime_persistence" }, severity: "high" },
    { finding_id: "finding:bbbbbbbbbbbbbbbb", category: "unknown_fail_closed", repairability: "unknown_fail_closed", subject: { target_role: "unknown" }, severity: "critical" },
  ]);
  assert.equal(graph.contract, "mad4b.recovery-causal-finding-graph.v1");
  assert.equal(graph.unknown_drift, true);
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.edges.every((edge) => edge.from.startsWith("finding:")));
  assert.equal(graph.secrets_included, false);
});

test("trust model exposes capability levels and dependency policy without database authority", () => {
  const model = getRecoveryTrustModel({ env: ENV, expectedSha: SHA });
  assert.equal(model.ok, true);
  assert.deepEqual(model.trust_roots, ["exact_production_sha", "recovery_manifest_hash", "deployment_attestation_hash", "target_fingerprint", "admin_principal_binding"]);
  assert.equal(model.database_independent_control_plane, true);
  assert.ok(model.dependency_graph.some((edge) => edge.prohibited === true));
  assert.equal(model.secrets_included, false);
});
