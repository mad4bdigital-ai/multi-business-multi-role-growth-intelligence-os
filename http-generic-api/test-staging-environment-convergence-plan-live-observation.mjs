import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";

const registry = readEnvironmentConvergenceRegistry();
const profile = registry.profiles.staging.activation_gateway;
const script = path.join(import.meta.dirname, "scripts/staging-environment-convergence-plan.mjs");
const commit = "a".repeat(40);
const oldCommit = "b".repeat(40);

function runPlanner(health, { preflightCommit = commit } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "staging-live-plan-"));
  try {
    const runtimePath = path.join(dir, "runtime.json");
    const preflightPath = path.join(dir, "preflight.json");
    const preloadPath = path.join(dir, "gateway-fetch-preload.mjs");
    fs.writeFileSync(runtimePath, JSON.stringify({
      commit,
      certification_status: "ready",
      certification_blocking_failures: [],
      certification_degraded_reasons: [],
    }));
    fs.writeFileSync(preflightPath, JSON.stringify({
      status: "passed",
      expected_commit: preflightCommit,
      observed_commit: preflightCommit,
      safety: {
        production_access: false,
        provider_access: false,
        database_mutation: false,
        migration_apply: false,
      },
    }));
    const status = health?.stale === true ? 503 : 200;
    fs.writeFileSync(preloadPath, `
const health = ${JSON.stringify(health)};
const status = ${status};
globalThis.fetch = async () => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return health; },
});
`, "utf8");
    const result = spawnSync(process.execPath, [
      "--import", pathToFileURL(preloadPath).href,
      script,
      "--runtime-state", runtimePath,
      "--preflight", preflightPath,
      "--repository", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      "--recovery-trust-exact", "true",
    ], { encoding: "utf8" });
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function healthy(overrides = {}) {
  return {
    ok: true,
    service: "activation-gateway",
    policyKey: profile.policy_key,
    policyHash: profile.expected_policy_hash,
    sourceCommit: commit,
    workerBuildSha: commit,
    stale: false,
    ...overrides,
  };
}

test("clean runtime with exact live Gateway remains not_required", () => {
  const result = runPlanner(healthy());
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "not_required");
  assert.deepEqual(output.observed_reasons, []);
  assert.equal(output.gateway_observation.sourceCommit, commit);
  assert.equal(output.safety.provider_mutation, false);
  assert.equal(output.safety.database_mutation, false);
  assert.equal(output.safety.production_mutation, false);
});

test("clean runtime cannot hide a live Gateway SHA mismatch", () => {
  const result = runPlanner(healthy({
    sourceCommit: oldCommit,
    workerBuildSha: oldCommit,
  }));
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "approval_required");
  assert.deepEqual(output.observed_reasons, ["gateway_exact_commit"]);
  assert.equal(output.report.convergence.status, "reconciliation_required");
  assert.equal(output.plan.release_spec.commit_sha, commit);
  assert.equal(output.plan.gateway_policy_identity.observed.source_commit, oldCommit);
  assert.equal(output.approval_checkpoint.required, true);
  assert.equal(output.plan.governed_handoff.automatic_apply_allowed, false);
  assert.equal(output.live_observed_gateway_source_commit, oldCommit);
  assert.equal(output.gateway_observation.workerBuildSha, oldCommit);
  const exactCommitCheck = output.report.convergence.classified_failures.find((entry) => entry.check_key === "gateway_exact_commit");
  assert.equal(exactCommitCheck?.detail?.source, "staging_activation_gateway_live_observation");
  assert.equal(exactCommitCheck?.detail?.source_commit, oldCommit);
  assert.equal(exactCommitCheck?.detail?.worker_build_sha, oldCommit);
  assert.equal(output.safety.provider_mutation, false);
  assert.equal(output.safety.database_mutation, false);
  assert.equal(output.safety.production_mutation, false);
});

test("worker-only SHA drift is represented by the mismatching worker commit", () => {
  const result = runPlanner(healthy({
    workerBuildSha: oldCommit,
  }));
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "approval_required");
  assert.deepEqual(output.observed_reasons, ["gateway_exact_commit"]);
  assert.equal(output.live_observed_gateway_source_commit, commit);
  assert.equal(output.live_observed_gateway_worker_build_sha, oldCommit);
  assert.equal(output.plan.gateway_policy_identity.observed.source_commit, commit);
  const exactCommitCheck = output.report.convergence.classified_failures.find((entry) => entry.check_key === "gateway_exact_commit");
  assert.equal(exactCommitCheck?.detail?.source, "staging_activation_gateway_live_observation");
  assert.equal(exactCommitCheck?.detail?.source_commit, commit);
  assert.equal(exactCommitCheck?.detail?.worker_build_sha, oldCommit);
  assert.equal(output.plan.governed_handoff.automatic_apply_allowed, false);
  assert.equal(output.safety.provider_mutation, false);
});

test("preflight SHA mismatch remains blocked before convergence", () => {
  const result = runPlanner(healthy(), { preflightCommit: oldCommit });
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stderr);
  assert.equal(output.status, "blocked");
  assert.equal(output.error.code, "staging_convergence_preflight_commit_mismatch");
  assert.equal(output.safety.provider_mutation, false);
  assert.equal(output.safety.database_mutation, false);
  assert.equal(output.safety.production_mutation, false);
});
