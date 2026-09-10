import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyDeploymentProvenance,
  readCanonicalDeploymentIdentity,
  readDeploymentManifest,
} from "./deploymentManifest.js";

const dir = mkdtempSync(join(tmpdir(), "mad4b-deployment-manifest-"));
const manifestPath = join(dir, "deployment-manifest.json");
const fullSha = "049bdfaff24966843cc1c55c9b61431d788acd60";

try {
  writeFileSync(manifestPath, JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Main",
    branch_source: "env:DEPLOYMENT_BRANCH",
    commit_sha: "abc123",
    commit_source: "env:DEPLOYMENT_COMMIT_SHA",
    deployed_at: "2026-05-15T00:00:00.000Z",
    service_version: "test",
  }));

  const env = { DEPLOYMENT_MANIFEST_PATH: manifestPath };
  const manifest = readDeploymentManifest(env);
  assert.equal(manifest.ok, true, "manifest is read from DEPLOYMENT_MANIFEST_PATH");
  assert.equal(manifest.manifest.commit_sha, "abc123", "commit sha is normalized");
  assert.equal(manifest.manifest.branch, "main", "main branch casing is canonicalized");
  assert.equal(manifest.manifest.branch_source, "env:DEPLOYMENT_BRANCH", "branch evidence source is normalized");
  assert.equal(manifest.manifest.commit_source, "env:DEPLOYMENT_COMMIT_SHA", "commit evidence source is normalized");

  assert.equal(
    classifyDeploymentProvenance({ manifestResult: manifest, env: { DEPLOYMENT_EXPECTED_COMMIT_SHA: "abc123" } }).deployment_status,
    "deployed_current",
    "matching expected commit is current"
  );

  assert.equal(
    classifyDeploymentProvenance({ manifestResult: manifest, env: { DEPLOYMENT_EXPECTED_COMMIT_SHA: "def456" } }).deployment_status,
    "deployed_stale",
    "mismatched expected commit is stale"
  );

  assert.equal(
    classifyDeploymentProvenance({ manifestResult: manifest, env: {} }).deployment_status,
    "deployment_commit_uncompared",
    "missing expected commit is explicitly uncompared"
  );

  assert.equal(
    readDeploymentManifest({ DEPLOYMENT_MANIFEST_PATH: join(dir, "missing.json") }).ok,
    false,
    "missing manifest reports incomplete"
  );

  const commitJsonOnly = readCanonicalDeploymentIdentity({
    env: {
      DEPLOYMENT_COMMIT_JSON: JSON.stringify({
        repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        branch: "Production",
        commit_sha: fullSha,
      }),
    },
  });
  assert.equal(commitJsonOnly.ok, true, "DEPLOYMENT_COMMIT_JSON is accepted as backward-compatible identity input");
  assert.equal(commitJsonOnly.source, "env:DEPLOYMENT_COMMIT_JSON");
  assert.equal(commitJsonOnly.sha, fullSha);
  assert.equal(commitJsonOnly.manifest_bound, true);

  const inlineManifestWins = readCanonicalDeploymentIdentity({
    env: {
      DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
        repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        branch: "Production",
        commit_sha: fullSha,
      }),
      DEPLOYMENT_COMMIT_JSON: JSON.stringify({
        repository: "wrong/repo",
        branch: "main",
        commit_sha: "1111111111111111111111111111111111111111",
      }),
    },
  });
  assert.equal(inlineManifestWins.ok, true);
  assert.equal(inlineManifestWins.source, "env:DEPLOYMENT_MANIFEST_JSON");
  assert.equal(inlineManifestWins.repository, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");
  assert.equal(inlineManifestWins.branch, "Production");
  assert.equal(inlineManifestWins.sha, fullSha);

  const fallbackIdentity = readCanonicalDeploymentIdentity({
    env: {
      GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      GITHUB_REF_NAME: "Production",
      GITHUB_SHA: fullSha,
    },
  });
  assert.equal(fallbackIdentity.ok, true, "legacy env fallback remains available when no manifest exists");
  assert.equal(fallbackIdentity.source, "env:fallback");
  assert.equal(fallbackIdentity.manifest_bound, false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("deployment manifest test passed");
