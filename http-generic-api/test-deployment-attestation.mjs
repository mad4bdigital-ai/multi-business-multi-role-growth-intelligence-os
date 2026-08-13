import assert from "node:assert/strict";
import { buildDeploymentAttestation, evaluateRuntimeIntegrity } from "./deploymentAttestation.js";

const productionSha = "a".repeat(40);
const resourceSha = "b".repeat(64);
const attestation = buildDeploymentAttestation({
  attestation_id: "attestation-fixture-20260812",
  environment_key: "production",
  repository_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  source_branch: "Production",
  source_commit_sha: productionSha,
  build_id: "build-20260812-1",
  build_timestamp: "2026-08-12T12:00:00.000Z",
  canonical_registry_revision: 7,
  canonical_resource_hashes: [{ resource_key: "system_bootstrap", path: "system_bootstrap.md", sha256: resourceSha }],
});
assert.match(attestation.attestation_sha256, /^[0-9a-f]{64}$/);
assert.equal(attestation.source_branch, "Production");

assert.throws(() => buildDeploymentAttestation({
  environment_key: "production",
  repository_uri: "github://x/y",
  source_branch: "main",
  source_commit_sha: productionSha,
  build_id: "bad",
}), (error) => error?.code === "deployment_attestation_production_branch_invalid");

const clean = evaluateRuntimeIntegrity({
  attestation,
  runtime_readback: { commit_sha: productionSha, readback_verified: true, working_tree_clean: true, unapproved_local_change_count: 0 },
});
assert.equal(clean.state, "verified_clean");
assert.equal(clean.ready, true);

const mismatched = evaluateRuntimeIntegrity({
  attestation,
  runtime_readback: { commit_sha: "c".repeat(40), readback_verified: true, working_tree_clean: true },
});
assert.equal(mismatched.state, "verification_failed");
assert.equal(mismatched.reason_code, "production_commit_mismatch");

const dirty = evaluateRuntimeIntegrity({
  attestation,
  runtime_readback: { commit_sha: productionSha, readback_verified: true, working_tree_clean: false, unapproved_local_change_count: 1 },
});
assert.equal(dirty.state, "degraded_unreconciled_change");

const breakGlass = evaluateRuntimeIntegrity({
  attestation,
  runtime_readback: { commit_sha: productionSha, readback_verified: true, working_tree_clean: false },
  break_glass: { active: true },
});
assert.equal(breakGlass.state, "break_glass_active");

console.log("deployment attestation and runtime integrity tests passed");
