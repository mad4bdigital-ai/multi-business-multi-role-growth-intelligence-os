#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeGovernedRestart } from "./hostinger-nodejs-production-restart-coherent.mjs";
import {
  HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
  validateConfiguration,
} from "./hostinger-nodejs-production-restart.mjs";

const EXPECTED_SHA = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const EXPECTED_BUILD = "019fc51c-3947-7255-aa4d-f55cb8df7658";
const OLD_SHA = "ca1e1cfe6697d251d2c50db7fa48246f18ab118f";

function response(status, body, contentType = "application/json") {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
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

function passedPreMutationAuthority() {
  return {
    contract: "mad4b.hostinger-pre-mutation-authority.v1",
    status: "passed",
    issue_open: true,
    main_sha: EXPECTED_SHA,
    production_sha: EXPECTED_SHA,
    binding: `${EXPECTED_SHA}:${EXPECTED_BUILD}`,
    run_id: "test-run",
    claim_comment_id: 42,
    claim_is_latest: true,
    later_marker_count: 0,
    secrets_included: false,
  };
}

function assertCoherentAuthority(report) {
  assert.equal(report.runtime_identity_authority.contract, "mad4b.hostinger-runtime-identity-authority.v1");
  assert.equal(report.runtime_identity_authority.authoritative_endpoint, "/deployment-info");
  assert.equal(report.runtime_identity_authority.schema_scope, "top_level_direct_identity_fields");
  assert.equal(report.runtime_identity_authority.cross_endpoint_composition_allowed, false);
  assert.equal(report.runtime_identity_authority.cross_object_composition_allowed, false);
  assert.equal(report.runtime_identity_authority.version_endpoint_authoritative, false);
  assert.equal(report.runtime_identity_authority.mode, "deployment_info_coherent_pair");
}

function assertAttemptState(report, attempted, performed) {
  assert.equal(report.restart.attempted, attempted);
  assert.equal(report.restart.performed, performed);
  assert.equal(report.side_effects.provider_mutation_attempted, attempted);
  if (performed) assert.equal(attempted, true);
}

async function testAlreadyCurrentSkipsRestart() {
  let posts = 0;
  let authorityChecks = 0;
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(EXPECTED_SHA, "Production"));
  };
  const report = await executeGovernedRestart(options(), {
    fetchImpl,
    sleepImpl: async () => {},
    beforeProviderMutation: async () => {
      authorityChecks += 1;
      return passedPreMutationAuthority();
    },
  });
  assert.equal(report.contract, HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT);
  assert.equal(report.outcome, "passed");
  assert.equal(report.classification, "runtime_already_current");
  assertAttemptState(report, false, false);
  assert.equal(posts, 0);
  assert.equal(authorityChecks, 0);
  assert.equal(report.pre_mutation_authority, null);
  assertCoherentAuthority(report);
}

async function testRestartConverges() {
  let restarted = false;
  let authorityChecks = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-converges-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { restarted = true; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(restarted ? EXPECTED_SHA : OLD_SHA, restarted ? "Production" : "main"));
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => {
        authorityChecks += 1;
        return passedPreMutationAuthority();
      },
    });
    assert.equal(report.outcome, "passed");
    assert.equal(report.classification, "restart_completed_runtime_current");
    assertAttemptState(report, true, true);
    assert.equal(authorityChecks, 1);
    assert.equal(report.pre_mutation_authority.status, "passed");
    assert.equal(report.side_effects.provider_mutation_performed, true);
    assert.equal(report.side_effects.build_creation_performed, false);
    assert.equal(report.side_effects.deployment_performed, false);
    assert.equal(report.secrets_included, false);
    const journal = JSON.parse(fs.readFileSync(path.join(outputDir, "hostinger-nodejs-production-restart-attempt.json"), "utf8"));
    assert.equal(journal.pre_mutation_authority, "passed");
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testPreMutationAuthorityFailureBlocksRestart() {
  let posts = 0;
  let authorityChecks = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-authority-failure-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(OLD_SHA, "main"));
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => {
        authorityChecks += 1;
        const error = new Error("main changed before restart");
        error.code = "main_head_changed_before_restart";
        throw error;
      },
    });
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_precondition_failed");
    assert.equal(report.first_failure.code, "main_head_changed_before_restart");
    assertAttemptState(report, false, false);
    assert.equal(authorityChecks, 1);
    assert.equal(posts, 0);
    assert.equal(report.pre_mutation_authority.status, "failed");
    assert.equal(report.pre_mutation_authority.failure_code, "main_head_changed_before_restart");
    assert.equal(fs.existsSync(path.join(outputDir, "hostinger-nodejs-production-restart-attempt.json")), false);
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testDifferentLatestBuildFailsClosed() {
  let posts = 0;
  let authorityChecks = 0;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/nodejs/builds")) return response(200, buildList("019fc999-3947-7255-aa4d-f55cb8df7658", "2026-08-03T01:30:00Z"));
    if (init.method === "POST") posts += 1;
    return response(200, { ok: true });
  };
  const report = await executeGovernedRestart(options(), {
    fetchImpl,
    sleepImpl: async () => {},
    beforeProviderMutation: async () => {
      authorityChecks += 1;
      return passedPreMutationAuthority();
    },
  });
  assert.equal(report.outcome, "failed");
  assert.equal(report.classification, "restart_precondition_failed");
  assert.equal(report.first_failure.code, "newer_or_different_build_detected");
  assertAttemptState(report, false, false);
  assert.equal(authorityChecks, 0);
  assert.equal(posts, 0);
  assertCoherentAuthority(report);
}

async function testRestartStaysStale() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-stale-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") return response(200, { ok: true });
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(OLD_SHA, "main"));
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedPreMutationAuthority(),
    });
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_completed_runtime_stale");
    assertAttemptState(report, true, true);
    assert.equal(report.first_failure.code, "runtime_parity_not_reached_after_restart");
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testSplitEndpointIdentityNeverPasses() {
  let posts = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-split-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    if (value.endsWith("/version")) return response(200, runtimeBody(EXPECTED_SHA, "unavailable"));
    if (value.endsWith("/deployment-info")) return response(200, runtimeBody(OLD_SHA, "Production"));
    throw new Error(`Unexpected URL ${value}`);
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedPreMutationAuthority(),
    });
    assert.equal(report.pre_runtime.current, false);
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_completed_runtime_stale");
    assertAttemptState(report, true, true);
    assert.equal(posts, 1);
    assert.equal(report.first_failure.code, "runtime_parity_not_reached_after_restart");
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testCrossObjectDeploymentIdentityNeverPasses() {
  let posts = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-cross-object-"));
  const deploymentBody = {
    branch: "main",
    commit_sha: OLD_SHA,
    deployment: {
      branch: "Production",
      commit_sha: EXPECTED_SHA,
      historical: true,
    },
  };
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    if (value.endsWith("/version")) return response(200, runtimeBody(OLD_SHA, "main"));
    if (value.endsWith("/deployment-info")) return response(200, deploymentBody);
    throw new Error(`Unexpected URL ${value}`);
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedPreMutationAuthority(),
    });
    assert.equal(report.pre_runtime.current, false);
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_completed_runtime_stale");
    assertAttemptState(report, true, true);
    assert.equal(posts, 1);
    assert.equal(report.first_failure.code, "runtime_parity_not_reached_after_restart");
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testNonStandardJsonContentTypeCannotBypassIdentityAuthority() {
  let posts = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-content-type-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") { posts += 1; return response(200, { ok: true }); }
    if (value.endsWith("/health")) return response(200, { ok: true });
    if (value.endsWith("/version")) return response(200, runtimeBody(EXPECTED_SHA, "unavailable"), "text/plain");
    if (value.endsWith("/deployment-info")) return response(200, runtimeBody(OLD_SHA, "Production"), "application/problem+json");
    throw new Error(`Unexpected URL ${value}`);
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedPreMutationAuthority(),
    });
    assert.equal(report.pre_runtime.current, false);
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_completed_runtime_stale");
    assertAttemptState(report, true, true);
    assert.equal(posts, 1);
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testAmbiguousPostTransportFailureConsumesAttempt() {
  let posts = 0;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostinger-restart-attempt-"));
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return response(200, buildList());
    if (init.method === "POST") {
      posts += 1;
      throw new Error("socket reset after request dispatch");
    }
    if (value.endsWith("/health")) return response(200, { ok: true });
    return response(200, runtimeBody(OLD_SHA, "main"));
  };
  try {
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedPreMutationAuthority(),
    });
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_attempted_outcome_unconfirmed");
    assert.equal(report.first_failure.code, "request_transport_failed");
    assertAttemptState(report, true, false);
    assert.equal(report.side_effects.provider_mutation_performed, false);
    assert.equal(posts, 1);
    const journalPath = path.join(outputDir, "hostinger-nodejs-production-restart-attempt.json");
    assert.equal(fs.existsSync(journalPath), true);
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    assert.equal(journal.contract, "mad4b.hostinger-nodejs-production-restart-attempt.v1");
    assert.equal(journal.restart_attempted, true);
    assert.equal(journal.provider_mutation_attempted, true);
    assert.equal(journal.pre_mutation_authority, "passed");
    assert.equal(journal.expected_sha, EXPECTED_SHA);
    assert.equal(journal.expected_build_uuid, EXPECTED_BUILD);
    assert.equal(journal.secrets_included, false);
    assertCoherentAuthority(report);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
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
  const coherentWrapper = fs.readFileSync(path.resolve(process.cwd(), "scripts/hostinger-nodejs-production-restart-coherent.mjs"), "utf8");
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
  assert.match(coherentWrapper, /deployment_info_coherent_pair/u);
  assert.match(coherentWrapper, /schema_scope:\s*"top_level_direct_identity_fields"/u);
  assert.match(coherentWrapper, /cross_endpoint_composition_allowed:\s*false/u);
  assert.match(coherentWrapper, /cross_object_composition_allowed:\s*false/u);
  assert.match(coherentWrapper, /persistAttemptJournal\(configuration\)/u);
  assert.match(coherentWrapper, /hostinger-nodejs-production-restart-attempt\.json/u);
  assert.match(coherentWrapper, /createGitHubPreMutationAuthorityRevalidator/u);
  assert.match(coherentWrapper, /main_head_changed_before_restart/u);
  assert.match(coherentWrapper, /production_head_changed_before_restart/u);
  assert.match(coherentWrapper, /current_run_claim_missing_before_restart/u);
  assert.match(coherentWrapper, /current_run_claim_superseded_before_restart/u);
  assert.match(coherentWrapper, /restart_claim_changed_before_mutation/u);
  assert.match(coherentWrapper, /authorityState\.result = await beforeProviderMutation\(\)/u);
  assert.match(coherentWrapper, /mutationState\.attempted = true/u);
  assert.match(coherentWrapper, /restart_attempted_outcome_unconfirmed/u);
  assert.match(workflow, /GITHUB_AUTH_EXPECTED_HEAD_SHA/u);
  assert.match(workflow, /GITHUB_AUTH_EXPECTED_PRODUCTION_SHA/u);
  assert.match(workflow, /GITHUB_AUTH_BINDING_ID/u);
  assert.match(workflow, /GITHUB_AUTH_RUN_ID/u);
  assert.match(workflow, /pre_mutation_authority=/u);
  assert.match(workflow, /mad4b\.hostinger-pre-mutation-authority\.v1/u);
  assert.match(workflow, /preMutationAuthority\.main_sha === process\.env\.EXPECTED_HEAD_SHA/u);
  assert.match(workflow, /preMutationAuthority\.claim_is_latest === true/u);
  assert.match(workflow, /preMutationAuthority\.later_marker_count === 0/u);
  assert.match(workflow, /hostinger-nodejs-production-restart-coherent\.mjs/u);
  assert.match(workflow, /authority\.schema_scope === "top_level_direct_identity_fields"/u);
  assert.match(workflow, /authority\.cross_endpoint_composition_allowed === false/u);
  assert.match(workflow, /authority\.cross_object_composition_allowed === false/u);
  assert.match(workflow, /effects\.provider_mutation_attempted === attempted/u);
  assert.match(workflow, /gh api --paginate --slurp/u);
  assert.match(workflow, /github-actions\[bot\]/u);
  assert.match(workflow, /marker_authority=github-actions-bot-only/u);
  assert.match(workflow, /status=claiming/u);
  assert.match(workflow, /id:\s*claim/u);
  assert.match(workflow, /echo "claimed=true" >> "\$\{GITHUB_OUTPUT\}"/u);
  assert.match(workflow, /An unresolved Hostinger restart claim already exists/u);
  assert.match(workflow, /lastRetryableRelease/u);
  assert.match(workflow, /Revalidate repository state and claim immediately before provider mutation/u);
  assert.ok((workflow.match(/git\/ref\/heads\/main/gu) || []).length >= 2);
  assert.ok((workflow.match(/git\/ref\/heads\/Production/gu) || []).length >= 2);
  assert.match(workflow, /Current run no longer owns the latest unresolved Hostinger restart claim/u);
  assert.match(workflow, /if: always\(\) && steps\.claim\.outputs\.claimed == 'true'/u);
  assert.match(workflow, /ATTEMPT_JOURNAL_PATH/u);
  assert.match(workflow, /restart_report_missing_after_provider_attempt/u);
  assert.match(workflow, /attempt_journal_present=\$\{attemptJournalExists\}/u);
  assert.match(workflow, /identity_scope=\$\{report\.runtime_identity_authority\?\.schema_scope/u);
  assert.match(workflow, /cross_object_composition=\$\{report\.runtime_identity_authority\?\.cross_object_composition_allowed === true/u);
  assert.match(workflow, /restart_attempted=\$\{restartAttempted\}/u);
  assert.match(workflow, /provider_mutation_attempted=\$\{report\.side_effects\?\.provider_mutation_attempted === true\}/u);
  assert.match(workflow, /includes\('restart_attempted=true'\)/u);
  assert.match(workflow, /const retryableWithoutProviderMutation = report\.outcome !== 'passed' && !restartAttempted/u);
  assert.match(workflow, /HOSTINGER_API_TOKEN/u);
  assert.match(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.doesNotMatch(workflow, /write-all/u);
  assert.doesNotMatch(workflow, /builds\/from-archive/u);
  assert.doesNotMatch(workflow, /git\/refs/u);
  assert.match(workflow, /hostinger-nodejs-production-restart-/u);
  assert.match(workflow, /expected_head_sha=\$\{process\.env\.EXPECTED_HEAD_SHA/u);
  assert.match(workflow, /retryable_without_provider_mutation=/u);
}

await testAlreadyCurrentSkipsRestart();
await testRestartConverges();
await testPreMutationAuthorityFailureBlocksRestart();
await testDifferentLatestBuildFailsClosed();
await testRestartStaysStale();
await testSplitEndpointIdentityNeverPasses();
await testCrossObjectDeploymentIdentityNeverPasses();
await testNonStandardJsonContentTypeCannotBypassIdentityAuthority();
await testAmbiguousPostTransportFailureConsumesAttempt();
testConfigurationGuards();
testWorkflowContract();
console.log("hostinger-nodejs-production-restart tests: passed");
