#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_CONTRACT,
  collectHostingerCompletedBuildLogEvidence,
  extractLogProvenance,
  parseArgs,
  redact,
  renderMarkdown,
  validateConfiguration,
} from "./hostinger-nodejs-completed-build-log-evidence.mjs";

const expectedSha = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const otherSha = "ca1e1cfe6697d251d2c50db7fa48246f18ab118f";
const buildUuid = "019fc51c-3947-7255-aa4d-f55cb8df7658";
const token = "hostinger-log-test-token-never-return";
const baseOptions = {
  accountUsername: "u338416126",
  domain: "auth.mad4b.com",
  buildUuid,
  expectedSha,
  outputDir: "/tmp/unused",
  timeoutMs: 5_000,
  token,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

assert.equal(parseArgs(["--build-uuid", buildUuid], {
  HOSTINGER_ACCOUNT_USERNAME: "u338416126",
  EXPECTED_PRODUCTION_SHA: expectedSha,
}).buildUuid, buildUuid);
assert.throws(() => validateConfiguration({ ...baseOptions, domain: "example.com" }), /restricted to auth\.mad4b\.com/);
assert.equal(redact(`Authorization: Bearer ${token}`).includes(token), false);

{
  const p = extractLogProvenance(`Checking out branch Production\ncommit ${expectedSha}\n/home/u1/domains/auth.mad4b.com/.builds/versions/${buildUuid}/nodejs`, expectedSha);
  assert.equal(p.expected_sha_found, true);
  assert.equal(p.production_branch_hint_found, true);
  assert.equal(p.release_path_hints.length, 1);
}

{
  let requestUrl = "";
  let auth = "";
  const report = await collectHostingerCompletedBuildLogEvidence(baseOptions, {
    now: () => new Date("2026-08-03T04:20:00.000Z"),
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      auth = init.headers.authorization;
      return jsonResponse({
        logs: `source branch=Production\ncheckout ${expectedSha}\nAuthorization: Bearer ${token}\npassword=hunter2`,
        lines: 4,
      });
    },
  });
  assert.equal(report.contract, HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_CONTRACT);
  assert.match(requestUrl, new RegExp(`${buildUuid}/logs\\?from_line=0$`));
  assert.equal(auth, `Bearer ${token}`);
  assert.equal(report.outcome, "passed");
  assert.equal(report.classification, "completed_build_logs_expected_sha");
  assert.equal(report.log_evidence.expected_sha_found, true);
  assert.match(report.log_evidence.excerpt, /Authorization: \[REDACTED\]/);
  assert.match(report.log_evidence.excerpt, /password=\[REDACTED\]/i);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.match(renderMarkdown(report), /Expected SHA found: `true`/);
}

{
  const report = await collectHostingerCompletedBuildLogEvidence(baseOptions, {
    fetchImpl: async () => jsonResponse({ logs: `checkout ${otherSha}` }),
  });
  assert.equal(report.outcome, "failed");
  assert.equal(report.classification, "completed_build_logs_other_sha");
  assert.equal(report.first_failure.code, "hostinger_completed_build_log_sha_mismatch");
}

{
  const report = await collectHostingerCompletedBuildLogEvidence(baseOptions, {
    fetchImpl: async () => jsonResponse({ logs: "Installing dependencies for branch Production" }),
  });
  assert.equal(report.outcome, "partial");
  assert.equal(report.classification, "completed_build_logs_production_branch_only");
}

{
  const report = await collectHostingerCompletedBuildLogEvidence({ ...baseOptions, token: "" }, {
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(report.outcome, "blocked");
  assert.equal(report.classification, "hostinger_api_token_unavailable");
  assert.equal(report.side_effects.credential_access_performed, false);
}

console.log("Hostinger completed-build log evidence contract passed.");
