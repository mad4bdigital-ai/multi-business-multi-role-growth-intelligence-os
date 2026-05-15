import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyDeploymentProvenance,
  readDeploymentManifest,
} from "./deploymentManifest.js";

const dir = mkdtempSync(join(tmpdir(), "mad4b-deployment-manifest-"));
const manifestPath = join(dir, "deployment-manifest.json");

try {
  writeFileSync(manifestPath, JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    commit_sha: "abc123",
    deployed_at: "2026-05-15T00:00:00.000Z",
    service_version: "test",
  }));

  const env = { DEPLOYMENT_MANIFEST_PATH: manifestPath };
  const manifest = readDeploymentManifest(env);
  assert.equal(manifest.ok, true, "manifest is read from DEPLOYMENT_MANIFEST_PATH");
  assert.equal(manifest.manifest.commit_sha, "abc123", "commit sha is normalized");

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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("deployment manifest test passed");
