#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeGovernedRestart,
  parseTrustedRestartMarker,
} from "./hostinger-nodejs-production-restart-coherent.mjs";
import {
  HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
  validateConfiguration,
} from "./hostinger-nodejs-production-restart.mjs";

const EXPECTED_SHA = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const EXPECTED_BUILD = "019fc51c-3947-7255-aa4d-f55cb8df7658";
const OLD_SHA = "ca1e1cfe6697d251d2c50db7fa48246f18ab118f";
const BINDING = `${EXPECTED_SHA}:${EXPECTED_BUILD}`;

function jsonResponse(status, body, contentType = "application/json") {
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

function buildList({
  uuid = EXPECTED_BUILD,
  created = "2026-08-03T00:53:09Z",
  updated = "2026-08-03T00:53:35Z",
  state = "completed",
  sourceType = "git",
  includeSourceType = true,
} = {}) {
  const buildOptions = { entry_file: "server.js" };
  if (includeSourceType) buildOptions.source_type = sourceType;
  return {
    data: [{
      uuid,
      state,
      created_at: created,
      updated_at: updated,
      options: buildOptions,
    }],
  };
}

function runtimeBody(sha, branch) {
  return {
    service: "http_generic_api_connector",
    deployed_commit_sha: sha,
    deployment_branch: branch,
  };
}

function passedAuthority() {
  return {
    contract: "mad4b.hostinger-pre-mutation-authority.v1",
    status: "passed",
    issue_open: true,
    main_sha: EXPECTED_SHA,
    production_sha: EXPECTED_SHA,
    binding: BINDING,
    run_id: "test-run",
    claim_comment_id: 42,
    claim_is_latest: true,
    later_marker_count: 0,
    marker_parser: "strict_single_line_exact_fields_v1",
    secrets_included: false,
  };
}

function assertAuthority(report) {
  assert.equal(report.runtime_identity_authority.contract, "mad4b.hostinger-runtime-identity-authority.v1");
  assert.equal(report.runtime_identity_authority.authoritative_endpoint, "/deployment-info");
  assert.equal(report.runtime_identity_authority.schema_scope, "top_level_direct_identity_fields");
  assert.equal(report.runtime_identity_authority.cross_endpoint_composition_allowed, false);
  assert.equal(report.runtime_identity_authority.cross_object_composition_allowed, false);
  assert.equal(report.runtime_identity_authority.version_endpoint_authoritative, false);
  assert.equal(report.runtime_identity_authority.mode, "deployment_info_coherent_pair");
}

function assertAttempt(report, attempted, performed) {
  assert.equal(report.restart.attempted, attempted);
  assert.equal(report.restart.performed, performed);
  assert.equal(report.side_effects.provider_mutation_attempted, attempted);
  if (performed) assert.equal(attempted, true);
}

async function withTempDir(prefix, callback) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await callback(outputDir);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function testRuntimeAlreadyCurrentSkipsMutation() {
  let posts = 0;
  let authorityChecks = 0;
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.includes("/nodejs/builds")) return jsonResponse(200, buildList());
    if (init.method === "POST") { posts += 1; return jsonResponse(200, { ok: true }); }
    if (value.endsWith("/health")) return jsonResponse(200, { ok: true });
    return jsonResponse(200, runtimeBody(EXPECTED_SHA, "Production"));
  };
  const report = await executeGovernedRestart(options(), {
    fetchImpl,
    sleepImpl: async () => {},
    beforeProviderMutation: async () => {
      authorityChecks += 1;
      return passedAuthority();
    },
  });
  assert.equal(report.contract, HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT);
  assert.equal(report.outcome, "passed");
  assert.equal(report.classification, "runtime_already_current");
  assertAttempt(report, false, false);
  assert.equal(posts, 0);
  assert.equal(authorityChecks, 0);
  assert.equal(report.pre_mutation_authority, null);
  assertAuthority(report);
}

async function testRestartConvergesAndPersistsJournal() {
  await withTempDir("hostinger-restart-converges-", async (outputDir) => {
    let restarted = false;
    let authorityChecks = 0;
    const fetchImpl = async (url, init = {}) => {
      const value = String(url);
      if (value.includes("/nodejs/builds")) return jsonResponse(200, buildList());
      if (init.method === "POST") { restarted = true; return jsonResponse(200, { ok: true }); }
      if (value.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(200, runtimeBody(restarted ? EXPECTED_SHA : OLD_SHA, restarted ? "Production" : "main"));
    };
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => {
        authorityChecks += 1;
        return passedAuthority();
      },
    });
    assert.equal(report.outcome, "passed");
    assert.equal(report.classification, "restart_completed_runtime_current");
    assertAttempt(report, true, true);
    assert.equal(authorityChecks, 1);
    assert.equal(report.pre_mutation_authority.status, "passed");
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
    assertAuthority(report);
  });
}

async function testAuthorityFailureBlocksPostAndJournal() {
  await withTempDir("hostinger-restart-authority-failure-", async (outputDir) => {
    let posts = 0;
    const fetchImpl = async (url, init = {}) => {
      const value = String(url);
      if (value.includes("/nodejs/builds")) return jsonResponse(200, buildList());
      if (init.method === "POST") { posts += 1; return jsonResponse(200, { ok: true }); }
      if (value.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(200, runtimeBody(OLD_SHA, "main"));
    };
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => {
        const error = new Error("main changed before restart");
        error.code = "main_head_changed_before_restart";
        throw error;
      },
    });
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_precondition_failed");
    assert.equal(report.first_failure.code, "main_head_changed_before_restart");
    assertAttempt(report, false, false);
    assert.equal(posts, 0);
    assert.equal(report.pre_mutation_authority.status, "failed");
    assert.equal(fs.existsSync(path.join(outputDir, "hostinger-nodejs-production-restart-attempt.json")), false);
    assertAuthority(report);
  });
}

async function assertBuildPreconditionFailure(buildBody, expectedCode) {
  let posts = 0;
  let authorityChecks = 0;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/nodejs/builds")) return jsonResponse(200, buildBody);
    if (init.method === "POST") posts += 1;
    return jsonResponse(200, { ok: true });
  };
  const report = await executeGovernedRestart(options(), {
    fetchImpl,
    sleepImpl: async () => {},
    beforeProviderMutation: async () => {
      authorityChecks += 1;
      return passedAuthority();
    },
  });
  assert.equal(report.outcome, "failed");
  assert.equal(report.classification, "restart_precondition_failed");
  assert.equal(report.first_failure.code, expectedCode);
  assertAttempt(report, false, false);
  assert.equal(authorityChecks, 0);
  assert.equal(posts, 0);
  assertAuthority(report);
}

async function testBuildPreconditionsFailClosed() {
  await assertBuildPreconditionFailure(
    buildList({ uuid: "019fc999-3947-7255-aa4d-f55cb8df7658", created: "2026-08-03T01:30:00Z" }),
    "newer_or_different_build_detected",
  );
  await assertBuildPreconditionFailure(
    buildList({ includeSourceType: false }),
    "authorized_build_source_not_git",
  );
  await assertBuildPreconditionFailure(
    buildList({ created: "2026-08-03T00:40:00Z", updated: "2026-08-03T01:30:00Z" }),
    "no_build_after_merge",
  );
}

async function testSplitAndNestedIdentityNeverPass() {
  const cases = [
    {
      prefix: "hostinger-restart-split-",
      version: runtimeBody(EXPECTED_SHA, "unavailable"),
      deployment: runtimeBody(OLD_SHA, "Production"),
      versionType: "application/json",
      deploymentType: "application/json",
    },
    {
      prefix: "hostinger-restart-nested-",
      version: runtimeBody(OLD_SHA, "main"),
      deployment: {
        branch: "main",
        commit_sha: OLD_SHA,
        deployment: { branch: "Production", commit_sha: EXPECTED_SHA, historical: true },
      },
      versionType: "text/plain",
      deploymentType: "application/problem+json",
    },
  ];
  for (const scenario of cases) {
    await withTempDir(scenario.prefix, async (outputDir) => {
      let posts = 0;
      const fetchImpl = async (url, init = {}) => {
        const value = String(url);
        if (value.includes("/nodejs/builds")) return jsonResponse(200, buildList());
        if (init.method === "POST") { posts += 1; return jsonResponse(200, { ok: true }); }
        if (value.endsWith("/health")) return jsonResponse(200, { ok: true });
        if (value.endsWith("/version")) return jsonResponse(200, scenario.version, scenario.versionType);
        if (value.endsWith("/deployment-info")) return jsonResponse(200, scenario.deployment, scenario.deploymentType);
        throw new Error(`Unexpected URL ${value}`);
      };
      const report = await executeGovernedRestart(options({ outputDir }), {
        fetchImpl,
        sleepImpl: async () => {},
        beforeProviderMutation: async () => passedAuthority(),
      });
      assert.equal(report.pre_runtime.current, false);
      assert.equal(report.outcome, "failed");
      assert.equal(report.classification, "restart_completed_runtime_stale");
      assertAttempt(report, true, true);
      assert.equal(posts, 1);
      assert.equal(report.first_failure.code, "runtime_parity_not_reached_after_restart");
      assertAuthority(report);
    });
  }
}

async function testAmbiguousPostConsumesAttempt() {
  await withTempDir("hostinger-restart-ambiguous-", async (outputDir) => {
    let posts = 0;
    const fetchImpl = async (url, init = {}) => {
      const value = String(url);
      if (value.includes("/nodejs/builds")) return jsonResponse(200, buildList());
      if (init.method === "POST") {
        posts += 1;
        throw new Error("socket reset after request dispatch");
      }
      if (value.endsWith("/health")) return jsonResponse(200, { ok: true });
      return jsonResponse(200, runtimeBody(OLD_SHA, "main"));
    };
    const report = await executeGovernedRestart(options({ outputDir }), {
      fetchImpl,
      sleepImpl: async () => {},
      beforeProviderMutation: async () => passedAuthority(),
    });
    assert.equal(report.outcome, "failed");
    assert.equal(report.classification, "restart_attempted_outcome_unconfirmed");
    assert.equal(report.first_failure.code, "request_transport_failed");
    assertAttempt(report, true, false);
    assert.equal(posts, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "hostinger-nodejs-production-restart-attempt.json")), true);
    assertAuthority(report);
  });
}

function botComment(id, body) {
  return {
    id,
    body,
    user: { login: "github-actions[bot]", type: "Bot" },
  };
}

function testStrictMarkerParser() {
  const body = `HOSTINGER_PRODUCTION_NODEJS_RESTART status=claiming binding=${BINDING} expected_head_sha=${EXPECTED_SHA} run_id=123 restart_attempted=false`;
  const parsed = parseTrustedRestartMarker(botComment(42, body));
  assert.equal(parsed.id, 42);
  assert.equal(parsed.fields.binding, BINDING);
  assert.equal(parsed.fields.expected_head_sha, EXPECTED_SHA);
  assert.equal(parsed.fields.run_id, "123");
  assert.equal(parseTrustedRestartMarker(botComment(43, `Summary:\n${body}`)), null);
  assert.equal(parseTrustedRestartMarker(botComment(44, `quoted ${body}`)), null);
  assert.equal(parseTrustedRestartMarker(botComment(45, `${body} run_id=123`)), null);
  assert.equal(parseTrustedRestartMarker({ ...botComment(46, body), user: { login: "owner", type: "User" } }), null);
  assert.equal(parseTrustedRestartMarker(botComment(47, "HOSTINGER_PRODUCTION_NODEJS_RESTART status=claiming")), null);
}

function testConfigurationAndSourceContracts() {
  assert.throws(() => validateConfiguration(options({ token: "" })), /HOSTINGER_API_TOKEN/u);
  assert.throws(() => validateConfiguration(options({ domain: "example.com" })), /restricted/u);
  assert.throws(() => validateConfiguration(options({ expectedBuildUuid: "bad" })), /UUID/u);

  const workflow = fs.readFileSync(path.resolve(process.cwd(), "../.github/workflows/hostinger-nodejs-production-restart.yml"), "utf8");
  const implementation = fs.readFileSync(path.resolve(process.cwd(), "scripts/hostinger-nodejs-production-restart.mjs"), "utf8");
  const coherent = fs.readFileSync(path.resolve(process.cwd(), "scripts/hostinger-nodejs-production-restart-coherent.mjs"), "utf8");

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /issue_comment:/u);
  assert.doesNotMatch(workflow, /(?:^|\n)\s*push\s*:/u);
  assert.doesNotMatch(workflow, /(?:^|\n)\s*pull_request(?:_target)?\s*:/u);
  assert.match(workflow, /github\.actor == github\.repository_owner/u);
  assert.match(workflow, /EVIDENCE_DIR:\s*\/tmp\/hostinger-nodejs-production-restart-\$\{\{ github\.run_id \}\}/u);
  assert.doesNotMatch(workflow, /EVIDENCE_DIR:\s*\$\{\{ runner\.temp \}\}/u);
  assert.match(workflow, /GITHUB_AUTH_EXPECTED_HEAD_SHA/u);
  assert.match(workflow, /GITHUB_AUTH_EXPECTED_PRODUCTION_SHA/u);
  assert.match(workflow, /GITHUB_AUTH_BINDING_ID/u);
  assert.match(workflow, /GITHUB_AUTH_RUN_ID/u);
  assert.match(workflow, /tokens\.shift\(\) !== 'HOSTINGER_PRODUCTION_NODEJS_RESTART'/u);
  assert.match(workflow, /marker\.fields\.restart_attempted === 'true'/u);
  assert.match(workflow, /lastClaim\.fields\.run_id !== process\.env\.GITHUB_RUN_ID/u);
  assert.match(workflow, /marker_parser=strict_single_line_exact_fields_v1/u);
  assert.doesNotMatch(workflow, /includes\('restart_attempted=true'\)/u);
  assert.match(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.doesNotMatch(workflow, /write-all/u);
  assert.doesNotMatch(workflow, /builds\/from-archive/u);
  assert.doesNotMatch(workflow, /git\/refs/u);

  assert.match(implementation, /function buildCreatedTimestamp/u);
  assert.match(implementation, /latest\.source_type !== "git"/u);
  assert.doesNotMatch(implementation, /Math\.max\(Date\.parse\(build\.created_at/u);
  assert.match(implementation, /nodejs\/server\/restart/u);

  assert.match(coherent, /export function parseTrustedRestartMarker/u);
  assert.match(coherent, /marker\.fields\.run_id === authority\.runId/u);
  assert.match(coherent, /fs\.fsyncSync\(fileDescriptor\)/u);
  assert.match(coherent, /fs\.renameSync\(temporaryPath, journalPath\)/u);
  assert.match(coherent, /fs\.fsyncSync\(directoryDescriptor\)/u);
  assert.match(coherent, /deployment_info_coherent_pair/u);
  assert.match(coherent, /schema_scope:\s*"top_level_direct_identity_fields"/u);
  assert.match(coherent, /cross_endpoint_composition_allowed:\s*false/u);
  assert.match(coherent, /cross_object_composition_allowed:\s*false/u);
  assert.match(coherent, /authorityState\.result = await beforeProviderMutation\(\)/u);
  assert.match(coherent, /persistAttemptJournal\(configuration\)/u);
  assert.match(coherent, /mutationState\.attempted = true/u);
  assert.match(coherent, /restart_attempted_outcome_unconfirmed/u);
}

await testRuntimeAlreadyCurrentSkipsMutation();
await testRestartConvergesAndPersistsJournal();
await testAuthorityFailureBlocksPostAndJournal();
await testBuildPreconditionsFailClosed();
await testSplitAndNestedIdentityNeverPass();
await testAmbiguousPostConsumesAttempt();
testStrictMarkerParser();
testConfigurationAndSourceContracts();
console.log("hostinger-nodejs-production-restart tests: passed");
