import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "mad4b-deployment-generator-"));
const manifestPath = join(dir, "deployment-manifest.json");
const stagingManifestPath = join(dir, "staging-deployment-manifest.json");
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const treeSha = "fedcba9876543210fedcba9876543210fedcba98";
const contextFileSetSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const imageDigest = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

try {
  execFileSync(process.execPath, [
    "scripts/generate-deployment-manifest.mjs",
    `--out=${manifestPath}`,
  ], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      DEPLOYMENT_BRANCH: "Main",
      DEPLOYMENT_COMMIT_SHA: commitSha,
    },
    stdio: "pipe",
  });

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.branch, "main", "deployment branch casing is canonicalized");
  assert.equal(manifest.branch_source, "env:DEPLOYMENT_BRANCH", "branch evidence source is recorded");
  assert.equal(manifest.commit_sha, commitSha, "explicit deployment commit is recorded");
  assert.equal(manifest.commit_source, "env:DEPLOYMENT_COMMIT_SHA", "commit evidence source is recorded");
  assert.equal(manifest.build_source, "git", "non-Staging build source remains git");
  assert.equal(manifest.secrets_included, false, "non-secret evidence is explicit");

  execFileSync(process.execPath, [
    "scripts/generate-deployment-manifest.mjs",
    `--out=${stagingManifestPath}`,
  ], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "staging",
      DEPLOY_BRANCH: "main",
      DEPLOY_COMMIT: commitSha,
      STAGING_BUILD_TREE: treeSha,
      STAGING_BUILD_CONTEXT_FILE_SET_SHA256: contextFileSetSha,
      STAGING_APP_IMAGE_ID: imageDigest,
    },
    stdio: "pipe",
  });

  const stagingManifest = JSON.parse(readFileSync(stagingManifestPath, "utf8"));
  assert.equal(stagingManifest.branch, "main", "Staging branch is canonicalized");
  assert.equal(stagingManifest.commit_sha, commitSha, "Staging commit is preserved");
  assert.equal(stagingManifest.tree_sha, treeSha, "Staging tree provenance is preserved");
  assert.equal(stagingManifest.tree_source, "git_archive_exact_commit", "Staging tree source is exact Git archive");
  assert.equal(stagingManifest.context_file_set_sha256, contextFileSetSha, "Staging context file-set provenance is preserved");
  assert.equal(stagingManifest.context_source, "git_archive_exact_commit", "Staging context source is exact Git archive");
  assert.equal(stagingManifest.image_digest, imageDigest, "Staging image digest is preserved");
  assert.equal(stagingManifest.build_source, "portable_staging_docker_build", "Staging build source is portable Docker build");
  assert.equal(stagingManifest.secrets_included, false, "Staging evidence is secret-free");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("deployment manifest generator test passed");
