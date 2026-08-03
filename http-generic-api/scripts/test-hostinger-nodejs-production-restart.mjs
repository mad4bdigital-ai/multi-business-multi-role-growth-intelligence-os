#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  executeGovernedRestart,
  HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
  validateConfiguration,
} from "./hostinger-nodejs-production-restart.mjs";

const EXPECTED_SHA = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const EXPECTED_BUILD = "019fc51c-3947-7255-aa4d-f55cb8df7658";
const OLD_SHA = "ca1e1cfe6697d251d2c50db7fa48246f18ab118f";

function response(status, body) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function options(overrides = {}) {
  return {
    accountUsername: "u338416126",
    domain: "auth.mad4b.com",
    expectedSha: EXPECTED_SHA,
    expectedBuildUuid: EXPECTED_BUILD,
    productionMergedAt: "2026-08-03T00:53:07Z",
    outputDir: "/tmp/unused",
    timeoutMs: 5_000,
    pollAttempts: 2,
    pollIntervalMs: 0,
    token: "test-secret-token",
    ...overrides,
  };
}

function buildList(uuid = EXPECTED_BUILD, created = "2026-08-03T00:53:09Z", state = "completed") {
  return { data: [{ uuid, state, created_at: created, updated_at: "2026-08-03T00:53:35Z", options: { source_type: "git", entry_file: "server.js" } }] };
}

function runtimeBody(sha, branch) {
  return { service: "http_generic_api_connector", deployed_commit_sha: sha, deployment_branch: branch };
}

async function testAlreadyCurrentSkipsRestart() {
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(EXPECTED_SHA, "Production"));
  };
  const report = await executeGovernedRestart(options(), { fetchImpl, sleepImpl: async () => {} });
  assert.equal(report.contract, HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT);
  assert.equal(report.outcome, "passed");
  assert.equal(report.classification, "runtime_already_current");
  assert.equal(report.restart.performed, false);
  assert.equal(posts, 0);
}

async function testRestartConverges() {
  let restarted = false;
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { restarted = true; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(restarted ? EXPECTED_SHA : OLD_SHA, restarted ? "Production" : "main"));
  };
  const report = await executeGovernedRestart(options(), { fetchImpl, sleepImpl: async () => {} });
  assert.equal(report.outcome, "passed");
  assert.equal(report.classification, "restart_completed_runtime_current");
  assert.equal(report.restart.performed, true);
  assert.equal(report.side_effects.provider_mutation_performed, true);
  assert.equal(report.side_effects.build_creation_performed, false);
  assert.equal(report.side_effects.deployment_performed, false);
  assert.equal(report.secrets_included, false);
}

async function testDifferentLatestBuildFailsClosed() {
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/nodejs/builds")) return response(200, buildList("019fc999-3947-7255-aa4d-f55cb8df7658", "2026-08-03T01:30:00Z"));
    if (init.method === "POST") posts += 1;
    return response(200, { ok: true });
  };
  const report = await executeGovernedRestart(options(), { fetchImpl, sleepImpl: async () => {} });
  assert.equal(report.outcome, "failed");
  assert.equal(report.classification, "restart_precondition_failed");
  assert.equal(report.first_failure.code, "newer_or_different_build_detected");
  assert.equal(posts, 0);
}

async function testRestartStaysStale() {
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") return response(200, { ok: true });
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(OLD_SHA, "main"));
  };
  const report = await executeGovernedRestart(options(), { fetchImpl, sleepImpl: async () => {} });
  assert.equal(report.outcome, "failed");
  assert.equal(report.classification, "restart_completed_runtime_stale");
  assert.equal(report.restart.performed, true);
  assert.equal(report.first_failure.code, "runtime_parity_not_reached_after_restart");
}

function testConfigurationGuards() {
  assert.throws(() => validateConfiguration(options({ token: "" })), /HOSTINGER_API_TOKEN/u);
  assert.throws(() => validateConfiguration(options({ domain: "example.com" })), /restricted/u);
  assert.throws(() => validateConfiguration(options({ expectedBuildUuid: "bad" })), /UUID/u);
}

function testWorkflowContract() {
  const workflowPath = path.resolve(process.cwd(), "../.github/workflows/hostinger-nodejs-production-restart.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const implementation = fs.readFileSync(path.resolve(process.cwd(), "scripts/hostinger-nodejs-production-restart.mjs"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /expected_head_sha:/u);
  assert.match(workflow, /expected_build_uuid:/u);
  assert.match(workflow, /issue_comment:/u);
  assert.doesNotMatch(workflow, /(?:^|\n)\s*push\s*:/u);
  assert.doesNotMatch(workflow, /(?:^|\n)\s*pull_request(?:_target)?\s*:/u);
  assert.match(workflow, /github\.actor == github\.repository_owner/u);
  assert.match(workflow, /271942579/u);
  assert.match(workflow, /MUTATION_TARGET_BRANCH/u);
  assert.match(workflow, /Repository branch mutation is forbidden/u);
  assert.match(workflow, /f5c1ae8840b4d4452f2908bb0f23051880bb6896/u);
  assert.match(workflow, /019fc51c-3947-7255-aa4d-f55cb8df7658/u);
  assert.match(implementation, /nodejs\/server\/restart/u);
  assert.match(workflow, /HOSTINGER_API_TOKEN/u);
  assert.match(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.doesNotMatch(workflow, /write-all/u);
  assert.doesNotMatch(workflow, /builds\/from-archive/u);
  assert.doesNotMatch(workflow, /git\/refs/u);
  assert.match(workflow, /hostinger-nodejs-production-restart-/u);
}

await testAlreadyCurrentSkipsRestart();
await testRestartConverges();
await testDifferentLatestBuildFailsClosed();
await testRestartStaysStale();
testConfigurationGuards();
testWorkflowContract();
console.log("hostinger-nodejs-production-restart tests: passed");
