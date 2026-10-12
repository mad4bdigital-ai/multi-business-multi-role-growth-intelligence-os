import assert from "node:assert/strict";

import {
  evaluateImmutableStagingArtifactIntegrity,
} from "./stagingImmutableArtifactIntegrity.js";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const context = "c".repeat(64);
const image = `sha256:${"d".repeat(64)}`;

function runtime(overrides = {}) {
  return {
    state: "degraded",
    verified: false,
    provenance_verified: true,
    identity_verified: true,
    content_verified: false,
    checkout_detected: false,
    readback_available: false,
    tracked_file_mutation_detected: false,
    local_application_code_mutation_detected: false,
    dirty_tracked_file_count: 0,
    read_only_check: true,
    reason_codes: ["runtime_artifact_content_unverified"],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    commit_sha: commit,
    tree_sha: tree,
    context_file_set_sha256: context,
    image_digest: image,
    build_source: "portable_staging_docker_build",
    tree_source: "git_archive_exact_commit",
    context_source: "git_archive_exact_commit",
    secrets_included: false,
    ...overrides,
  };
}

{
  const result = evaluateImmutableStagingArtifactIntegrity({
    runtimeIntegrity: runtime(),
    appManifest: manifest(),
    expectedCommit: commit,
    expectedTree: tree,
    expectedContextFileSet: context,
    expectedImageDigest: image,
  });

  assert.equal(result.verified, true);
  assert.equal(result.checks.exact_reason, true);
  assert.equal(result.checks.image_exact, true);
}

{
  const result = evaluateImmutableStagingArtifactIntegrity({
    runtimeIntegrity: runtime({
      reason_codes: [
        "runtime_artifact_content_unverified",
        "unapproved_dirty_runtime",
      ],
    }),
    appManifest: manifest(),
    expectedCommit: commit,
    expectedTree: tree,
    expectedContextFileSet: context,
    expectedImageDigest: image,
  });

  assert.equal(result.verified, false);
  assert.equal(result.checks.exact_reason, false);
}

{
  const result = evaluateImmutableStagingArtifactIntegrity({
    runtimeIntegrity: runtime(),
    appManifest: manifest({
      image_digest: `sha256:${"e".repeat(64)}`,
    }),
    expectedCommit: commit,
    expectedTree: tree,
    expectedContextFileSet: context,
    expectedImageDigest: image,
  });

  assert.equal(result.verified, false);
  assert.equal(result.checks.image_exact, false);
}

{
  const result = evaluateImmutableStagingArtifactIntegrity({
    runtimeIntegrity: runtime({
      tracked_file_mutation_detected: true,
    }),
    appManifest: manifest(),
    expectedCommit: commit,
    expectedTree: tree,
    expectedContextFileSet: context,
    expectedImageDigest: image,
  });

  assert.equal(result.verified, false);
  assert.equal(result.checks.no_tracked_mutation, false);
}

console.log("staging immutable artifact integrity tests passed");
