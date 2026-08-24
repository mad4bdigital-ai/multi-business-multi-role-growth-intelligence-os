import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHostingerSshGate } from "./hostingerSshDeployExecutor.js";
import { buildDeploymentInfoRoutes } from "./routes/deploymentInfoRoutes.js";
import { buildVersionPayload } from "./deploymentManifest.js";

// frontend-surface-operation: GET /deployment-info/runtime-binding
// frontend-surface-operation: POST /deployment-info/runtime-bootstrap-dry-run

function fakePool(row) {
  return {
    async query() {
      return [[row]];
    },
  };
}

const migration = readFileSync(new URL("./migrations/1004_sprint68_hostinger_ssh_executor_db_gate.sql", import.meta.url), "utf8");
assert.match(migration, /remote_runtime_hostinger_ssh_executor_enabled/);
assert.match(migration, /'enabled', false/);
assert.match(migration, /'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f'/);
assert.match(migration, /'expires_at', NULL/);
assert.match(migration, /same-cycle dry-run/i);
assert.match(migration, /post-deploy readback/i);
assert.match(migration, /secrets_included=false/);

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
const previousRuntimeDbName = process.env.DB_NAME;
const previousRuntimeDbUser = process.env.DB_USER;
const previousRuntimeGovernanceDbName = process.env.GOVERNANCE_DB_NAME;
const previousGithubSha = process.env.GITHUB_SHA;
const previousGithubRefName = process.env.GITHUB_REF_NAME;
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
  process.env.DB_NAME = "runtime-discovery-test";
  process.env.DB_USER = "runtime-principal-test";
  process.env.GOVERNANCE_DB_NAME = "governance-discovery-test";

  const app = express();
  app.use(express.json());
  let integrityReaderInput;
  app.use(buildDeploymentInfoRoutes({
    runtimeIntegrityReader: async (input) => {
      integrityReaderInput = input;
      return ({
      contract: "mad4b.runtime-integrity.v1",
      state: "degraded",
      verified: false,
      tracked_checkout_clean: false,
      local_application_code_mutation_detected: true,
      dirty_tracked_file_count: 1,
      expected_commit_sha_available: true,
      checkout_commit_sha_available: true,
      commit_matches: true,
      checkout_detected: true,
      readback_available: true,
      read_only_check: true,
      untracked_files_ignored: true,
      reason_codes: ["unapproved_dirty_runtime"],
      secrets_included: false,
      provenance_verified: false,
      provenance_source: null,
    });
    },
    requireBackendApiKey: (req, res, next) => {
      if (req.headers["x-api-key"] === "test-backend-key") {
        req.auth = { mode: "backend_api_key", principal_type: "admin", is_admin: true };
        return next();
      }
      if (req.headers.authorization === "Bearer simulated-user-jwt") {
        req.auth = { mode: "user_jwt", principal_type: "user", is_admin: false, user_id: "user-1" };
        return next();
      }
      return res.status(401).json({ ok: false, error: { code: "missing_backend_api_key" } });
    },
    runtimeBootstrapStatusReader: async () => ({
      contract: "mad4b.hostinger.runtime-bootstrap-status.v1",
      status: "bootstrap_required",
      hook: { required: true, configured: false, auto_apply: false, startup_apply: false, prestart_apply: false, docker_start_apply: false, values_exposed: false },
      database_connection_performed: false,
      database_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      normal_route_bypass: false,
      reasons: ["explicit_release_hook_not_configured"],
      secrets_included: false,
    }),
    productionActivationReadinessReader: async () => ({
      contract: "mad4b.production-activation-readiness.v1",
      status: "blocked",
      ok: false,
      ready: false,
      checks: {
        mcp_catalog_schema_ready: false,
        governance_db_privilege_ready: false,
        runtime_persistence_ready: false,
      },
      hard_activation_blocked_until_ready: true,
      read_only_probe: true,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      deployment_performed: false,
      secrets_included: false,
    }),
  }));
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

  assert.equal(deploymentInfo.ok, true, "service diagnostics may remain healthy while runtime integrity is degraded");
  assert.equal(deploymentInfo.commit_sha, commitSha, "deployment-info must prioritize canonical manifest commit");
  assert.equal(deploymentInfo.branch, "main", "deployment-info must prioritize canonical manifest branch");
  assert.equal(deploymentInfo.expected_dev_branch, "main", "main is the canonical staging branch");
  assert.equal(deploymentInfo.deployment.present, true);
  assert.equal(deploymentInfo.deployment.commit_sha, commitSha);
  assert.equal(deploymentInfo.evidence.canonical_manifest_detected, true);
  assert.equal(deploymentInfo.evidence.manifest_error, null);
  assert.equal(integrityReaderInput.provenanceCommitSha, commitSha);
  assert.equal(integrityReaderInput.provenanceDetected, true);
  assert.equal(integrityReaderInput.provenanceSource, manifestPath);
  assert.equal(deploymentInfo.runtime_integrity.state, "degraded");
  assert.equal(deploymentInfo.runtime_integrity.verified, false);
  assert.equal(deploymentInfo.runtime_integrity.local_application_code_mutation_detected, true);
  assert.deepEqual(deploymentInfo.runtime_integrity.reason_codes, ["unapproved_dirty_runtime"]);
  assert.equal(deploymentInfo.evidence.runtime_integrity_state, "degraded");
  assert.equal(deploymentInfo.evidence.runtime_integrity_verified, false);
  assert.equal(deploymentInfo.runtime_integrity.read_only_check, true);
  assert.equal(deploymentInfo.runtime_bootstrap_status.contract, "mad4b.hostinger.runtime-bootstrap-status.v1");
  assert.equal(deploymentInfo.runtime_bootstrap_status.status, "bootstrap_required");
  assert.equal(deploymentInfo.runtime_bootstrap_status.database_mutation_performed, false);
  assert.equal(deploymentInfo.runtime_bootstrap_status.migration_apply_performed, false);
  assert.equal(deploymentInfo.runtime_bootstrap_status.hook.auto_apply, false);
  assert.equal(version.deployment.deployed_commit_sha, commitSha);
  assert.equal(
    deploymentInfo.commit_sha,
    version.deployment.deployed_commit_sha,
    "/deployment-info and /version must report the same deployed commit"
  );
  assert.equal(Object.hasOwn(deploymentInfo, "production_activation_readiness"), false, "combined readiness must remain opt-in");

  const bindingUnauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-binding`);
  assert.equal(bindingUnauthorizedResponse.status, 401);
  const bindingUserJwtResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-binding`, { headers: { authorization: "Bearer simulated-user-jwt" } });
  assert.equal(bindingUserJwtResponse.status, 403);
  const bindingUserJwtInfo = await bindingUserJwtResponse.json();
  assert.equal(bindingUserJwtInfo.error.code, "backend_service_api_key_required");
  const bindingResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-binding`, { headers: { "x-api-key": "test-backend-key" } });
  assert.equal(bindingResponse.status, 200);
  const bindingInfo = await bindingResponse.json();
  assert.equal(bindingInfo.ok, true);
  assert.equal(bindingInfo.runtime_binding.configured, true);
  assert.equal(bindingInfo.runtime_binding.database_sha256, "6195886430387397fcbdd86c75e75a72528b08f2d19d7b36ed570df021710ede");
  assert.equal(bindingInfo.runtime_binding.raw_values_exposed, false);
  assert.equal(bindingInfo.runtime_binding.secrets_included, false);
  assert.equal(Object.hasOwn(bindingInfo.runtime_binding, "database"), false);
  assert.equal(Object.hasOwn(bindingInfo.runtime_binding, "principal"), false);
  assert.equal(bindingInfo.runtime_binding.database_connection_performed, false);
  assert.equal(bindingInfo.runtime_binding.database_mutation_performed, false);

  process.env.DEPLOYMENT_MANIFEST_PATH = join(dir, "missing-deployment-manifest.json");
  process.env.GITHUB_SHA = commitSha;
  process.env.GITHUB_REF_NAME = "Production";
  const dryRunUserJwtResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-bootstrap-dry-run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer simulated-user-jwt" },
    body: JSON.stringify({ expected_sha: commitSha }),
  });
  assert.equal(dryRunUserJwtResponse.status, 403);
  const dryRunUserJwtInfo = await dryRunUserJwtResponse.json();
  assert.equal(dryRunUserJwtInfo.error.code, "backend_service_api_key_required");

  const mismatchResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-bootstrap-dry-run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-backend-key" },
    body: JSON.stringify({ expected_sha: "fedcba9876543210fedcba9876543210fedcba98" }),
  });
  assert.equal(mismatchResponse.status, 412);
  const mismatchInfo = await mismatchResponse.json();
  assert.equal(mismatchInfo.error.code, "runtime_bootstrap_deployment_identity_mismatch");
  assert.equal(mismatchInfo.database_connection_performed, false);
  assert.equal(mismatchInfo.database_mutation_performed, false);
  assert.equal(mismatchInfo.migration_apply_performed, false);
  assert.equal(mismatchInfo.grant_mutation_performed, false);

  const dryRunResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info/runtime-bootstrap-dry-run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-backend-key" },
    body: JSON.stringify({ expected_sha: commitSha }),
  });
  assert.equal(dryRunResponse.status, 412);
  const dryRunInfo = await dryRunResponse.json();
  assert.equal(dryRunInfo.error.code, "bootstrap_credentials_missing");
  assert.equal(dryRunInfo.target_source, "runtime_env");
  assert.equal(dryRunInfo.database_connection_performed, false);
  assert.equal(dryRunInfo.database_mutation_performed, false);
  assert.equal(dryRunInfo.migration_apply_performed, false);
  assert.equal(dryRunInfo.grant_mutation_performed, false);
  assert.equal(dryRunInfo.secrets_included, false);

  const readinessResponse = await fetch(`http://127.0.0.1:${address.port}/deployment-info?include_production_activation_readiness=1`);
  assert.equal(readinessResponse.status, 200);
  const readinessInfo = await readinessResponse.json();
  assert.equal(readinessInfo.production_activation_readiness.ok, false);
  assert.equal(readinessInfo.production_activation_readiness.hard_activation_blocked_until_ready, true);
  assert.equal(readinessInfo.production_activation_readiness.read_only_probe, true);
  assert.equal(readinessInfo.production_activation_readiness.sql_mutation_performed, false);
  assert.equal(readinessInfo.production_activation_readiness.migration_apply_performed, false);
  assert.equal(readinessInfo.production_activation_readiness.secrets_included, false);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousManifestPath === undefined) delete process.env.DEPLOYMENT_MANIFEST_PATH;
  else process.env.DEPLOYMENT_MANIFEST_PATH = previousManifestPath;
  if (previousRuntimeDbName === undefined) delete process.env.DB_NAME;
  else process.env.DB_NAME = previousRuntimeDbName;
  if (previousRuntimeDbUser === undefined) delete process.env.DB_USER;
  else process.env.DB_USER = previousRuntimeDbUser;
  if (previousRuntimeGovernanceDbName === undefined) delete process.env.GOVERNANCE_DB_NAME;
  else process.env.GOVERNANCE_DB_NAME = previousRuntimeGovernanceDbName;
  if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
  else process.env.GITHUB_SHA = previousGithubSha;
  if (previousGithubRefName === undefined) delete process.env.GITHUB_REF_NAME;
  else process.env.GITHUB_REF_NAME = previousGithubRefName;
  rmSync(dir, { recursive: true, force: true });
}

console.log("runtime gate and deployment diagnostics parity tests passed");
