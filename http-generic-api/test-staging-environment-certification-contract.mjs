import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(apiRoot, "..");
const authorityScript = path.join(apiRoot, "scripts/staging-environment-authority-closure.mjs");
const impactScript = path.join(apiRoot, "scripts/environment-impact-closure.mjs");
const liveScript = path.join(apiRoot, "scripts/staging-live-certification.mjs");
const expectedCommit = "1".repeat(40);
const expectedTree = "2".repeat(40);
const expectedContextFileSet = "3".repeat(64);
const expectedImageDigest = `sha256:${"4".repeat(64)}`;
assert.match(fs.readFileSync(liveScript, "utf8"), /STAGING_CERT_EXPECTED_TREE/);
assert.match(fs.readFileSync(liveScript, "utf8"), /STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256/);
assert.match(fs.readFileSync(liveScript, "utf8"), /app_image_digest_exact/);
assert.match(fs.readFileSync(liveScript, "utf8"), /artifact_set/);

const staticReport = path.join(os.tmpdir(), `staging-authority-${process.pid}.json`);
const impactReport = path.join(os.tmpdir(), `staging-impact-${process.pid}.json`);
const staticRun = spawnSync(process.execPath, [
  authorityScript,
  "--expected-sha", expectedCommit,
  "--report-file", staticReport,
], { cwd: root, encoding: "utf8" });
assert.equal(staticRun.status, 0, staticRun.stderr || staticRun.stdout);
const authority = JSON.parse(fs.readFileSync(staticReport, "utf8"));
assert.equal(authority.contract, "mad4b.staging-environment-authority-closure.v1");
assert.equal(authority.converged, true);
assert.equal(authority.issue_count, 0);
assert.equal(authority.staging_authority.source_branch, "main");
assert.equal(authority.production_authority.source_branch, "Production");
assert.equal(authority.staging_authority.production_traffic_allowed, false);
assert.equal(authority.gateway.mutation_stale_policy, "deny");
assert.equal(authority.gateway.read_stale_grace_seconds, 0);
assert.equal(authority.db_authority.generic_runtime_principal_fallback, false);
assert.equal(authority.environment_contract.same_cycle_readback_required, true);
assert.equal(authority.safety.read_only, true);
assert.equal(authority.safety.database_mutation, false);
assert.equal(authority.safety.production_deploy, false);

const impactRun = spawnSync(process.execPath, [
  impactScript,
  "--head-sha", expectedCommit,
  "--report-file", impactReport,
], { cwd: root, encoding: "utf8" });
assert.equal(impactRun.status, 0, impactRun.stderr || impactRun.stdout);
const impact = JSON.parse(fs.readFileSync(impactReport, "utf8"));
assert.equal(impact.contract, "mad4b.environment-impact-closure.v1");
assert.equal(impact.converged, true);
assert.equal(impact.issue_count, 0);
assert.equal(impact.schema_compatibility.required_field, "mcp_catalog_level");
assert.equal(impact.schema_compatibility.matching_migration_count, 1);
assert.equal(impact.db_authority.generic_runtime_principal_fallback, false);
assert.equal(impact.gateway.stale_mutation_policy, "deny");
assert.equal(impact.safety.read_only, true);
assert.equal(impact.safety.database_mutation, false);
assert.equal(impact.safety.migration_apply, false);
assert.equal(impact.safety.provider_mutation, false);
assert.equal(impact.safety.production_deploy, false);
assert.equal(impact.safety.secrets_included, false);

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function deploymentBody({ commit = expectedCommit, databaseReady = true } = {}) {
  return {
    ok: true,
    service: "growth-intelligence-platform",
    branch: "main",
    commit,
    commit_sha: commit,
    app_env: "staging",
    deployment: {
      present: true,
      commit_sha: commit,
      tree_sha: expectedTree,
      context_file_set_sha256: expectedContextFileSet,
      image_digest: expectedImageDigest,
      secrets_included: false,
    },
    runtime_integrity: {
      contract: "mad4b.runtime-integrity.v1",
      state: "verified",
      verified: true,
      provenance_verified: true,
      read_only_check: true,
      reason_codes: [],
      secrets_included: false,
    },
    mcp_catalog_schema_readiness: {
      ok: databaseReady,
      status: databaseReady ? "ready" : "blocked",
      reason: databaseReady ? null : "schema_contract_not_ready",
      required_migration: databaseReady ? null : "20260815_custom_gpt_mcp_catalog_levels.sql",
      secrets_included: false,
    },
    governance_db_privilege_readiness: {
      ready: databaseReady,
      status: databaseReady ? "ready" : "blocked",
      reason: databaseReady ? null : "governance_db_privilege_not_ready",
      secrets_included: false,
    },
    production_activation_readiness: {
      contract: "mad4b.production-activation-readiness.v1",
      status: databaseReady ? "ready" : "blocked",
      ok: databaseReady,
      ready: databaseReady,
      checks: {
        mcp_catalog_schema_ready: databaseReady,
        governance_db_privilege_ready: databaseReady,
        runtime_persistence_ready: databaseReady,
      },
      read_only_probe: true,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      provider_mutation_performed: false,
      secrets_included: false,
    },
    evidence: { secrets_included: false },
  };
}

const gatewayPolicy = {
  policy_key: "activation_gateway_staging",
  public_host: "activation-dev.example.test",
  content_hash_sha256: "a".repeat(64),
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "staging-cert-"));
const gatewayPolicyPath = path.join(tempDir, "route-policy.staging.json");
fs.writeFileSync(gatewayPolicyPath, `${JSON.stringify(gatewayPolicy, null, 2)}\n`);

let currentDeployment = deploymentBody();
let gatewaySourceCommit = expectedCommit;
const app = await listen((req, res) => {
  if (req.url?.startsWith("/deployment-info")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(currentDeployment));
    return;
  }
  res.writeHead(404).end();
});
const gateway = await listen((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "activation-gateway",
      policyKey: gatewayPolicy.policy_key,
      policyHash: gatewayPolicy.content_hash_sha256,
      sourceCommit: gatewaySourceCommit,
      stale: false,
      secretsIncluded: false,
    }));
    return;
  }
  if (req.url === "/ready") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, upstreamReady: true, secretsIncluded: false }));
    return;
  }
  res.writeHead(404).end();
});

function runLive(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [liveScript], {
      cwd: root,
      env: {
        ...process.env,
        STAGING_CERT_EXPECTED_COMMIT: expectedCommit,
        STAGING_CERT_EXPECTED_BRANCH: "main",
        STAGING_CERT_EXPECTED_TREE: expectedTree,
        STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256: expectedContextFileSet,
        STAGING_CERT_APP_IMAGE_ID: expectedImageDigest,
        STAGING_CERT_APP_BASE_URL: app.baseUrl,
        STAGING_CERT_REQUIRE_GATEWAY: "true",
        STAGING_CERT_GATEWAY_BASE_URL: gateway.baseUrl,
        STAGING_CERT_GATEWAY_POLICY_PATH: gatewayPolicyPath,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      try {
        const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
        const report = JSON.parse(lines.at(-1));
        resolve({ run: { status: code, stdout, stderr }, report });
      } catch (error) {
        reject(new Error(`live certification child did not return canonical JSON: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`));
      }
    });
  });
}

try {
  const ready = await runLive({ STAGING_CERT_REQUIRE_READY: "true", STAGING_CERT_REQUIRE_GATEWAY_UPSTREAM: "true" });
  assert.equal(ready.run.status, 0, ready.run.stderr || ready.run.stdout);
  assert.equal(ready.report.outcome, "ready");
  assert.equal(ready.report.ready, true);
  assert.deepEqual(ready.report.blocking_failures, []);
  assert.deepEqual(ready.report.degraded_reasons, []);
  assert.equal(ready.report.gateway.expected_source_commit, expectedCommit);
  assert.equal(ready.report.artifact_set.complete, true);
  assert.equal(ready.report.artifact_set.app.tree_sha, expectedTree);
  assert.equal(ready.report.artifact_set.app.context_file_set_sha256, expectedContextFileSet);
  assert.equal(ready.report.artifact_set.app.image_digest, expectedImageDigest);
  assert.equal(ready.report.safety.database_mutation, false);
  assert.equal(ready.report.safety.migration_apply, false);
  assert.equal(ready.report.safety.production_deploy, false);

  gatewaySourceCommit = "0".repeat(40);
  const gatewayMismatch = await runLive({ STAGING_CERT_REQUIRE_READY: "false" });
  assert.equal(gatewayMismatch.run.status, 1);
  assert.equal(gatewayMismatch.report.outcome, "blocked");
  assert.ok(gatewayMismatch.report.blocking_failures.includes("gateway_exact_commit"));
  gatewaySourceCommit = expectedCommit;

  currentDeployment = deploymentBody({ databaseReady: false });
  const degraded = await runLive({ STAGING_CERT_REQUIRE_READY: "false" });
  assert.equal(degraded.run.status, 0, degraded.run.stderr || degraded.run.stdout);
  assert.equal(degraded.report.outcome, "degraded");
  assert.equal(degraded.report.ready, false);
  assert.ok(degraded.report.degraded_reasons.includes("combined_database_readiness"));
  assert.ok(degraded.report.degraded_reasons.includes("mcp_catalog_schema_ready"));

  const degradedRequired = await runLive({ STAGING_CERT_REQUIRE_READY: "true" });
  assert.equal(degradedRequired.run.status, 1);
  assert.equal(degradedRequired.report.outcome, "degraded");

  currentDeployment = deploymentBody({ commit: "2".repeat(40), databaseReady: true });
  const blocked = await runLive({ STAGING_CERT_REQUIRE_READY: "false" });
  assert.equal(blocked.run.status, 1);
  assert.equal(blocked.report.outcome, "blocked");
  assert.ok(blocked.report.blocking_failures.includes("exact_commit"));
} finally {
  await new Promise((resolve) => app.server.close(resolve));
  await new Promise((resolve) => gateway.server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(staticReport, { force: true });
  fs.rmSync(impactReport, { force: true });
}

console.log("Staging environment authority and live certification contract tests passed");
