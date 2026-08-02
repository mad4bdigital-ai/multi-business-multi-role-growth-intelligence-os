#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FRONTEND_DISPATCH_EVIDENCE_CONTRACT,
  runFrontendDispatchVerificationEvidence,
} from "./frontend-dispatch-verification-evidence.mjs";

const candidateSha = "c".repeat(40);
const sourceHeadSha = "d".repeat(40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-dispatch-evidence-"));

try {
  const stages = [
    { id: "first", label: "First", command: process.execPath, args: ["first.mjs"] },
    { id: "second", label: "Second", command: process.execPath, args: ["second.mjs"] },
    { id: "third", label: "Third", command: process.execPath, args: ["third.mjs"] },
  ];
  const calls = [];
  const times = [10, 20, 40, 70];
  const failed = runFrontendDispatchVerificationEvidence({
    outputDir: path.join(root, "failed"),
    stages,
    env: {
      CI_CANDIDATE_KIND: "merge_candidate",
      CI_CANDIDATE_SHA: candidateSha,
      CI_SOURCE_HEAD_SHA: sourceHeadSha,
      GITHUB_WORKFLOW: "Frontend surface dispatch",
      GITHUB_RUN_ID: "456",
      GITHUB_HEAD_REF: "gpt/evidence",
      GITHUB_BASE_REF: "main",
    },
    now: () => times.shift(),
    spawnSync(command, args) {
      calls.push([command, ...args]);
      if (calls.length === 1) return { status: 0, signal: null, stdout: "ok", stderr: "" };
      return {
        status: 1,
        signal: null,
        stdout: "access_token=visible-token",
        stderr: "AssertionError: exact baseline mismatch\nclient_secret=swordfish",
      };
    },
  });

  assert.equal(calls.length, 2, "verification must stop at the first failed stage");
  assert.equal(failed.report.contract, FRONTEND_DISPATCH_EVIDENCE_CONTRACT);
  assert.equal(failed.report.outcome, "failed");
  assert.equal(failed.report.identity.candidate_sha, candidateSha);
  assert.equal(failed.report.identity.source_head_sha, sourceHeadSha);
  assert.equal(failed.report.stages[0].status, "passed");
  assert.equal(failed.report.stages[0].duration_ms, 10);
  assert.equal(failed.report.stages[1].status, "failed");
  assert.equal(failed.report.stages[1].duration_ms, 30);
  assert.equal(failed.report.first_failure.stage_id, "second");
  assert.equal(failed.report.routing.consult_job_logs, false);
  assert.equal(failed.report.secrets_included, false);
  assert.doesNotMatch(JSON.stringify(failed.report), /visible-token|swordfish/u);
  assert.match(failed.report.first_failure.diagnostic.stderr.tail, /exact baseline mismatch/u);
  assert.ok(fs.existsSync(failed.jsonPath));
  assert.ok(fs.existsSync(failed.markdownPath));

  const passed = runFrontendDispatchVerificationEvidence({
    outputDir: path.join(root, "passed"),
    stages: stages.slice(0, 2),
    env: {
      CI_CANDIDATE_KIND: "head",
      CI_CANDIDATE_SHA: candidateSha,
      CI_SOURCE_HEAD_SHA: candidateSha,
    },
    now: (() => {
      let value = 0;
      return () => {
        value += 5;
        return value;
      };
    })(),
    spawnSync() {
      return { status: 0, signal: null, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(passed.report.outcome, "passed");
  assert.equal(passed.report.first_failure, null);
  assert.equal(passed.report.stages.length, 2);
  assert.equal(passed.report.routing.consult_job_logs, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tests: 2,
  gate: "frontend_dispatch_structured_verification_evidence",
  contract: FRONTEND_DISPATCH_EVIDENCE_CONTRACT,
  secrets_included: false,
}));
