import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHostingerSshGate } from "./hostingerSshDeployExecutor.js";
import { buildDeploymentInfoRoutes } from "./routes/deploymentInfoRoutes.js";
import { buildVersionPayload } from "./deploymentManifest.js";

function fakePool(row) {
  return {
    async query() {
      return [[row]];
    },
  };
}

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const targetId = "target-runtime-gate-test";
const dbKey = "remote_runtime_hostinger_ssh_executor_enabled";
const envFlag = "REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED";

const enabledGate = await loadHostingerSshGate(
  fakePool({ status: "active", config_json: JSON.stringify({ enabled: true, target_id: targetId, expires_at: future }) }),
  { targetId, env: {}, envFlag, dbKey }
);
assert.equal(enabledGate.enabled, true, "active unexpired target-bound DB gate must enable execution");
assert.equal(enabledGate.source, "platform_runtime_config");
assert.equal(enabledGate.key, dbKey);
assert.equal(enabledGate.target_allowed, true);

const mismatchGate = await loadHostingerSshGate(
  fakePool({ status: "active", config_json: JSON.stringify({ enabled: true, target_id: "other-target", expires_at: future }) }),
  { targetId, env: {}, envFlag, dbKey }
);
assert.equal(mismatchGate.enabled, false, "DB gate must reject a different target");
assert.equal(mismatchGate.reason, "db_gate_target_mismatch");

const expiredGate = await loadHostingerSshGate(
  fakePool({ status: "active", config_json: JSON.stringify({ enabled: true, target_id: targetId, expires_at: past }) }),
  { targetId, env: {}, envFlag, dbKey }
);
assert.equal(expiredGate.enabled, false, "expired DB gate must not enable execution");
assert.equal(expiredGate.reason, "db_gate_expired");

const envGate = await loadHostingerSshGate(fakePool(null), {
  targetId,
  env: { [envFlag]: "true" },
  envFlag,
  dbKey,
});
assert.equal(envGate.enabled, true, "legacy process ENV gate must remain supported");
assert.equal(envGate.source, "env");

const dir = mkdtempSync(join(tmpdir(), "mad4b-deployment-info-parity-"));
const manifestPath = join(dir, "deployment-manifest.json");
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const previousManifestPath = process.env.DEPLOYMENT_MANIFEST_PATH;
let server;

try {
  writeFileSync(manifestPath, JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    branch_source: "env:ACTIVATION_GITHUB_BRANCH",
    commit_sha: commitSha,
    commit_source: "git",
    deployed_at: "2026-06-14T17:10:13.176Z",
    service_version: "test",
    build_source: "git",
  }));
  process.env.DEPLOYMENT_MANIFEST_PATH = manifestPath;

  const app = express();
  app.use(buildDeploymentInfoRoutes());
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/deployment-info`);
  assert.equal(response.status, 200);
  const deploymentInfo = await response.json();
  const version = buildVersionPayload({
    serviceVersion: "test",
    env: { DEPLOYMENT_MANIFEST_PATH: manifestPath },
  });

  assert.equal(deploymentInfo.commit_sha, commitSha, "deployment-info must prioritize canonical manifest commit");
  assert.equal(deploymentInfo.branch, "main", "deployment-info must prioritize canonical manifest branch");
  assert.equal(deploymentInfo.deployment.present, true);
  assert.equal(deploymentInfo.deployment.commit_sha, commitSha);
  assert.equal(deploymentInfo.evidence.canonical_manifest_detected, true);
  assert.equal(deploymentInfo.evidence.manifest_error, null);
  assert.equal(version.deployment.deployed_commit_sha, commitSha);
  assert.equal(
    deploymentInfo.commit_sha,
    version.deployment.deployed_commit_sha,
    "/deployment-info and /version must report the same deployed commit"
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousManifestPath === undefined) delete process.env.DEPLOYMENT_MANIFEST_PATH;
  else process.env.DEPLOYMENT_MANIFEST_PATH = previousManifestPath;
  rmSync(dir, { recursive: true, force: true });
}

console.log("runtime gate and deployment diagnostics parity tests passed");
