#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GOVERNED_REFRESH_DISPATCH_CONTRACT,
  dispatchGovernedGeneratedArtifactRefresh,
} from "./dispatch-governed-generated-artifact-refresh.mjs";

const repository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const targetRef = "gpt/016-remote-mcp-oauth21-main-recovery-20260802";
const expectedHeadSha = "a".repeat(40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "governed-refresh-dispatch-"));

try {
  let request = null;
  const passed = await dispatchGovernedGeneratedArtifactRefresh({
    repository,
    target_ref: targetRef,
    expected_head_sha: expectedHeadSha,
    token: "unit-test-token",
    output_dir: path.join(root, "passed"),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        status: 204,
        statusText: "No Content",
        headers: { get: (name) => name.toLowerCase() === "x-github-request-id" ? "unit-request-id" : null },
        async text() { return ""; },
      };
    },
  });

  assert.equal(passed.report.contract, GOVERNED_REFRESH_DISPATCH_CONTRACT);
  assert.equal(passed.report.outcome, "passed");
  assert.equal(passed.report.http_status, 204);
  assert.equal(passed.report.github_request_id, "unit-request-id");
  assert.equal(passed.report.routing.consult_job_logs, false);
  assert.equal(passed.report.secrets_included, false);
  assert.ok(fs.existsSync(passed.jsonPath));
  assert.ok(fs.existsSync(passed.markdownPath));
  assert.match(request.url, /actions\/workflows\/governed-generated-artifact-refresh\.yml\/dispatches$/u);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.authorization, "Bearer unit-test-token");
  const payload = JSON.parse(request.init.body);
  assert.deepEqual(payload, {
    ref: "main",
    inputs: {
      target_ref: targetRef,
      expected_head_sha: expectedHeadSha,
      confirmation: "APPLY_GENERATED_ARTIFACT_REFRESH",
    },
  });

  const blocked = await dispatchGovernedGeneratedArtifactRefresh({
    repository,
    target_ref: targetRef,
    expected_head_sha: expectedHeadSha,
    token: "unit-test-token",
    output_dir: path.join(root, "blocked"),
    fetchImpl: async () => ({
      status: 403,
      statusText: "Forbidden",
      headers: { get: () => null },
      async text() {
        return JSON.stringify({ message: "authorization: Bearer visible-token", token: "top-secret" });
      },
    }),
  });
  assert.equal(blocked.report.outcome, "blocked");
  assert.equal(blocked.report.first_failure?.code, "workflow_dispatch_rejected");
  assert.equal(blocked.report.http_status, 403);
  assert.equal(blocked.report.routing.consult_job_logs, false);
  assert.doesNotMatch(JSON.stringify(blocked.report), /visible-token|top-secret|unit-test-token/u);

  const protectedBranch = await dispatchGovernedGeneratedArtifactRefresh({
    repository,
    target_ref: "main",
    expected_head_sha: expectedHeadSha,
    token: "unit-test-token",
    output_dir: path.join(root, "protected"),
    fetchImpl: async () => {
      throw new Error("fetch must not be called for invalid inputs");
    },
  });
  assert.equal(protectedBranch.report.outcome, "blocked");
  assert.equal(protectedBranch.report.first_failure?.code, "workflow_dispatch_preflight_failed");
  assert.match(protectedBranch.report.first_failure?.diagnostic_tail || "", /non-protected work branch/u);

  const invalidSha = await dispatchGovernedGeneratedArtifactRefresh({
    repository,
    target_ref: targetRef,
    expected_head_sha: "abc",
    token: "unit-test-token",
    output_dir: path.join(root, "invalid-sha"),
    fetchImpl: async () => {
      throw new Error("fetch must not be called for invalid inputs");
    },
  });
  assert.equal(invalidSha.report.outcome, "blocked");
  assert.match(invalidSha.report.first_failure?.diagnostic_tail || "", /40-character SHA/u);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tests: 4,
  gate: "governed_generated_artifact_refresh_dispatch_evidence",
  contract: GOVERNED_REFRESH_DISPATCH_CONTRACT,
  secrets_included: false,
}));
