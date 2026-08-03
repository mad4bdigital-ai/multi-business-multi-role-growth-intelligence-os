#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  HOSTINGER_NODEJS_BUILD_EVIDENCE_CONTRACT,
  collectHostingerNodejsBuildEvidence,
  parseArgs,
  redact,
  renderMarkdown,
  validateConfiguration,
} from "./hostinger-nodejs-build-evidence.mjs";

const expectedSha = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const mergedAt = "2026-08-03T00:53:07.000Z";
const token = "hostinger-test-token-never-return";
const baseOptions = {
  accountUsername: "u338416126",
  domain: "auth.mad4b.com",
  expectedSha,
  productionMergedAt: mergedAt,
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

assert.equal(parseArgs(["--expected-sha", expectedSha], {
  HOSTINGER_ACCOUNT_USERNAME: "u338416126",
  PRODUCTION_MERGED_AT: mergedAt,
}).expectedSha, expectedSha);
assert.throws(() => validateConfiguration({ ...baseOptions, domain: "example.com" }), /restricted to auth\.mad4b\.com/);
assert.equal(redact(`Authorization: Bearer ${token}`).includes(token), false);

{
  let requestUrl = null;
  let authorization = null;
  const report = await collectHostingerNodejsBuildEvidence(baseOptions, {
    now: () => new Date("2026-08-03T01:20:00.000Z"),
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      authorization = init.headers.authorization;
      return jsonResponse({ data: [] });
    },
  });
  assert.equal(report.contract, HOSTINGER_NODEJS_BUILD_EVIDENCE_CONTRACT);
  assert.match(requestUrl, /^https:\/\/developers\.hostinger\.com\/api\/hosting\/v1\/accounts\/u338416126\/websites\/auth\.mad4b\.com\/nodejs\/builds\?page=1$/);
  assert.equal(authorization, `Bearer ${token}`);
  assert.equal(report.classification, "no_build_after_merge");
  assert.equal(report.outcome, "failed");
  assert.equal(JSON.stringify(report).includes(token), false);
}

{
  const calls = [];
  const report = await collectHostingerNodejsBuildEvidence(baseOptions, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/logs")) {
        return jsonResponse({
          logs: `Authorization: Bearer ${token}\npassword=hunter2\nreal build error`,
          lines: 3,
        });
      }
      return jsonResponse({
        data: [{
          uuid: "build-failed-1",
          state: "failed",
          created_at: "2026-08-03T01:00:00Z",
          updated_at: "2026-08-03T01:02:00Z",
          options: { branch: "Production", access_token: token },
        }],
      });
    },
  });
  assert.equal(report.classification, "build_failed");
  assert.equal(report.outcome, "failed");
  assert.equal(calls.length, 2);
  assert.match(calls[1], /build-failed-1\/logs\?from_line=0$/);
  assert.match(report.failed_build_logs.excerpt, /REDACTED/);
  assert.match(report.failed_build_logs.excerpt, /password=\[REDACTED\]/i);
  assert.equal(JSON.stringify(report).includes(token), false);
}

{
  const report = await collectHostingerNodejsBuildEvidence(baseOptions, {
    fetchImpl: async () => jsonResponse({
      data: {
        data: [{
          uuid: "build-complete-1",
          state: "completed",
          created_at: "2026-08-03T01:00:00Z",
          updated_at: "2026-08-03T01:03:00Z",
          options: { branch: "Production", commit_sha: expectedSha },
        }],
      },
    }),
  });
  assert.equal(report.classification, "build_completed_expected_sha");
  assert.equal(report.outcome, "passed");
  assert.deepEqual(report.latest_build_after_merge.source_shas, [expectedSha]);
}

{
  const report = await collectHostingerNodejsBuildEvidence(baseOptions, {
    fetchImpl: async () => jsonResponse({
      data: [{
        uuid: "build-complete-no-sha",
        state: "completed",
        created_at: "2026-08-03T01:00:00Z",
        updated_at: "2026-08-03T01:03:00Z",
        options: { branch: "Production" },
      }],
    }),
  });
  assert.equal(report.classification, "build_completed_source_unverified");
  assert.equal(report.outcome, "partial");
  assert.match(renderMarkdown(report), /Source SHAs exposed by API: none/);
}

{
  const report = await collectHostingerNodejsBuildEvidence(baseOptions, {
    fetchImpl: async () => jsonResponse({ error: { message: `Bad ${token}` } }, 401),
  });
  assert.equal(report.classification, "hostinger_api_unauthorized");
  assert.equal(report.outcome, "failed");
  assert.equal(JSON.stringify(report).includes(token), false);
}

{
  const report = await collectHostingerNodejsBuildEvidence({ ...baseOptions, token: "" }, {
    fetchImpl: async () => {
      throw new Error("fetch must not run without token");
    },
  });
  assert.equal(report.classification, "hostinger_api_token_unavailable");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.side_effects.credential_access_performed, false);
}

console.log("Hostinger Node.js build evidence contract passed.");
