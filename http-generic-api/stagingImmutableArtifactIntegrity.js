const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function text(value) {
  return String(value || "").trim().toLowerCase();
}

export function evaluateImmutableStagingArtifactIntegrity({
  runtimeIntegrity,
  appManifest,
  expectedCommit,
  expectedTree,
  expectedContextFileSet,
  expectedImageDigest,
} = {}) {
  const reasons = Array.isArray(runtimeIntegrity?.reason_codes)
    ? runtimeIntegrity.reason_codes
    : [];

  const observedCommit = text(appManifest?.commit_sha);
  const observedTree = text(appManifest?.tree_sha);
  const observedContext = text(appManifest?.context_file_set_sha256);
  const observedImage = text(appManifest?.image_digest);

  const expected = {
    commit: text(expectedCommit),
    tree: text(expectedTree),
    context: text(expectedContextFileSet),
    image: text(expectedImageDigest),
  };

  const checks = Object.freeze({
    degraded_artifact_mode:
      runtimeIntegrity?.verified === false
      && runtimeIntegrity?.state === "degraded",

    provenance_verified:
      runtimeIntegrity?.provenance_verified === true,

    identity_verified:
      runtimeIntegrity?.identity_verified === true,

    content_unverified_as_expected:
      runtimeIntegrity?.content_verified === false,

    no_checkout_expected:
      runtimeIntegrity?.checkout_detected === false
      && runtimeIntegrity?.readback_available === false,

    no_tracked_mutation:
      runtimeIntegrity?.tracked_file_mutation_detected === false
      && runtimeIntegrity?.local_application_code_mutation_detected === false
      && Number(runtimeIntegrity?.dirty_tracked_file_count || 0) === 0,

    read_only:
      runtimeIntegrity?.read_only_check === true,

    exact_reason:
      reasons.length === 1
      && reasons[0] === "runtime_artifact_content_unverified",

    commit_exact:
      SHA40.test(expected.commit)
      && observedCommit === expected.commit,

    tree_exact:
      SHA40.test(expected.tree)
      && observedTree === expected.tree,

    context_exact:
      SHA256.test(expected.context)
      && observedContext === expected.context,

    image_present:
      SHA256_IMAGE.test(observedImage),

    image_exact:
      SHA256_IMAGE.test(expected.image)
      && observedImage === expected.image,

    portable_staging_build:
      appManifest?.build_source === "portable_staging_docker_build",

    git_archive_tree:
      appManifest?.tree_source === "git_archive_exact_commit",

    git_archive_context:
      appManifest?.context_source === "git_archive_exact_commit",

    manifest_secret_free:
      appManifest?.secrets_included === false,
  });

  return Object.freeze({
    verified: Object.values(checks).every(Boolean),
    checks,
    reason_codes: reasons,
    observed: Object.freeze({
      commit_sha: observedCommit || null,
      tree_sha: observedTree || null,
      context_file_set_sha256: observedContext || null,
      image_digest: observedImage || null,
    }),
    secrets_included: false,
  });
}
