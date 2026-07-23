import assert from "node:assert/strict";
import {
  attachRepositoryMutationCoordination,
  buildRepositoryMutationIntent,
  evaluateRepositoryMutationCoordination,
} from "./repositoryMutationCoordinationTelemetry.js";

const branch = "gpt/example";
const intent = buildRepositoryMutationIntent("repo_patch_batch_apply", {
  branch,
  expected_base_sha: "a".repeat(40),
  expected_branch_sha: "b".repeat(40),
  changes: [{ path: "http-generic-api/scripts/test-manifest.mjs" }, { path: "http-generic-api/scripts/test-manifest.mjs" }],
});
assert.equal(intent.operation_type, "repo_patch_batch_apply");
assert.deepEqual(intent.paths, ["http-generic-api/scripts/test-manifest.mjs"]);
assert.equal(intent.base_sha, "a".repeat(40));

const advisory = evaluateRepositoryMutationCoordination("repo_patch_batch_apply", {
  branch,
  changes: [{ path: "http-generic-api/scripts/test-manifest.mjs" }],
  active_repository_leases: [{
    branch,
    holder_run_id: "other-run",
    lease_mode: "path_scoped_write",
    paths: ["http-generic-api/scripts/test-manifest.mjs"],
    status: "active",
    expires_at: "2999-01-01T00:00:00Z",
  }],
});
assert.equal(advisory.mode, "advisory");
assert.equal(advisory.decision.action, "merge_with_policy");
assert.equal(advisory.should_block, false);
assert.equal(advisory.secrets_included, false);

const driftAdvisory = evaluateRepositoryMutationCoordination("repo_patch_apply", {
  branch,
  path: "http-generic-api/routes/gptToolsRoutes.js",
  expected_base_sha: "a".repeat(40),
  repository_current_state: { base_sha: "c".repeat(40) },
});
assert.equal(driftAdvisory.decision.action, "reclassify");
assert.equal(driftAdvisory.should_block, false);

const driftCritical = evaluateRepositoryMutationCoordination("repo_patch_apply", {
  branch,
  path: "http-generic-api/routes/gptToolsRoutes.js",
  expected_base_sha: "a".repeat(40),
  repository_current_state: { base_sha: "c".repeat(40) },
  repository_coordination_critical_guard: true,
});
assert.equal(driftCritical.mode, "critical_guard");
assert.equal(driftCritical.should_block, true);
assert.equal(driftCritical.block_reason_code, "repository_sha_drift_detected");

const readbackCritical = evaluateRepositoryMutationCoordination("repo_existing_blob_commit_apply", {
  branch,
  files: [{ path: "http-generic-api/repositoryCoordinationPlane.js" }],
  repository_current_state: { unknown_provider_outcome: true, same_cycle_readback_verified: false },
  repository_coordination_critical_guard: true,
});
assert.equal(readbackCritical.decision.action, "requires_readback");
assert.equal(readbackCritical.should_block, true);

const attached = attachRepositoryMutationCoordination({ ok: true, result: { changed: 1 } }, advisory);
assert.equal(attached.repository_coordination.action, "merge_with_policy");
assert.equal(attached.repository_coordination.should_block, false);
assert.deepEqual(attached.repository_coordination.policy_groups, ["test_manifest"]);
console.log("repository mutation coordination telemetry tests passed");
