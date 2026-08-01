#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCiEvidenceSummary, renderCiEvidenceMarkdown } from "./ci-evidence-router.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-router-"));
}

function write(root, name, data) {
  fs.writeFileSync(path.join(root, name), `${JSON.stringify(data, null, 2)}\n`);
}

{
  const root = tempDir();
  try {
    write(root, "e2e-parallel-work-evaluation.json", {
      schema_version: 1,
      policy_key: "e2e_phase_governance",
      ok: true,
      pr_mode: "workstream",
      feature_key: "014-example",
      workstream_id: "recovery-attestation",
      findings: [],
      secrets_included: false
    });
    write(root, "e2e-parallel-execution.json", {
      schema_version: 1,
      ok: false,
      feature_key: "014-example",
      mode: "workstream",
      workstream_id: "recovery-attestation",
      results: [
        { test_id: "recovery", status: "passed", exit_code: 0 },
        {
          test_id: "attestation",
          status: "failed",
          exit_code: 1,
          diagnostic: { stderr: { tail: "AssertionError: expected subject binding", truncated: false } }
        }
      ],
      secrets_included: false
    });
    const summary = buildCiEvidenceSummary({
      inputDir: root,
      context: {
        workflow: "E2E Phase Governance",
        runId: "123",
        commitSha: "a".repeat(40),
        headRef: "gpt/example",
        baseRef: "integration",
        evaluateResult: "success",
        executeResult: "failure"
      }
    });
    assert.equal(summary.outcome, "failed");
    assert.equal(summary.first_failure.test_id, "attestation");
    assert.equal(summary.routing.consult_job_logs, false);
    assert.equal(summary.policy.job_logs_role, "diagnostic_only");
    assert.match(renderCiEvidenceMarkdown(summary), /expected subject binding/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempDir();
  try {
    write(root, "e2e-phase-evaluation.json", {
      schema_version: 1,
      ok: false,
      findings: [{ code: "mvp_not_implemented", feature_key: "014-example" }],
      secrets_included: false
    });
    const summary = buildCiEvidenceSummary({
      inputDir: root,
      context: { evaluateResult: "failure", executeResult: "skipped" }
    });
    assert.equal(summary.outcome, "blocked");
    assert.equal(summary.first_failure.code, "mvp_not_implemented");
    assert.equal(summary.routing.consult_job_logs, true);
    assert.equal(summary.routing.log_access_reason, "structured_failure_has_no_bounded_diagnostic");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempDir();
  try {
    const summary = buildCiEvidenceSummary({
      inputDir: root,
      context: { evaluateResult: "success", executeResult: "success" }
    });
    assert.equal(summary.outcome, "evidence_error");
    assert.equal(summary.routing.consult_job_logs, true);
    assert(summary.integrity_findings.some((finding) => finding.code === "canonical_source_reports_missing"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempDir();
  try {
    write(root, "e2e-parallel-work-evaluation.json", {
      ok: true,
      pr_mode: "workstream",
      commit_sha: "b".repeat(40),
      findings: [],
      secrets_included: false
    });
    const summary = buildCiEvidenceSummary({
      inputDir: root,
      context: {
        commitSha: "a".repeat(40),
        evaluateResult: "success",
        executeResult: "skipped"
      }
    });
    assert.equal(summary.outcome, "evidence_error");
    assert(summary.integrity_findings.some((finding) => finding.code === "source_report_head_mismatch"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, tests: 4, contract: "mad4b.ci-evidence-summary.v1", secrets_included: false }));
