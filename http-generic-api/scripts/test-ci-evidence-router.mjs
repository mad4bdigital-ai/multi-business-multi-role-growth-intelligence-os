#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCiEvidenceSummary, renderCiEvidenceMarkdown } from "./ci-evidence-router.mjs";

const SHA = "a".repeat(40);
const CONTEXT = Object.freeze({
  workflow: "E2E Phase Governance",
  runId: "123",
  candidateKind: "head",
  candidateSha: SHA,
  sourceHeadSha: SHA,
  headRef: "gpt/example",
  baseRef: "main",
  evaluateResult: "success",
  executeResult: "success",
  mariadbCertificationResult: "skipped",
  mariadbCertificationEvidencePath: null
});

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-router-")); }
function write(root, name, data) { fs.writeFileSync(path.join(root, name), `${JSON.stringify(data, null, 2)}\n`); }
function source(contract, extra = {}) {
  return { contract, candidate_kind: "head", candidate_sha: SHA, ok: true, secrets_included: false, ...extra };
}
function summaryFor(files, context = CONTEXT) {
  const root = tempDir();
  try {
    for (const [name, data] of Object.entries(files)) write(root, name, data);
    return buildCiEvidenceSummary({ inputDir: root, context });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(certRoot, { recursive: true, force: true });
  }
}

{
  const summary = summaryFor({
    "e2e-parallel-work-evaluation.json": source("mad4b.e2e-parallel-work-evaluation.v1", { pr_mode: "workstream", feature_key: "014-example", workstream_id: "recovery-attestation", findings: [] }),
    "e2e-parallel-execution.json": source("mad4b.e2e-parallel-execution.v1", {
      ok: false,
      mode: "workstream",
      workstream_id: "recovery-attestation",
      results: [{ test_id: "attestation", status: "failed", exit_code: 1, diagnostic: { stderr: { tail: "AssertionError: expected subject binding" } } }]
    })
  }, { ...CONTEXT, executeResult: "failure" });
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.first_failure.test_id, "attestation");
  assert.equal(summary.routing.consult_job_logs, false);
  assert.equal(summary.identity.candidate_kind, "head");
  assert.equal(summary.identity.candidate_sha, SHA);
  assert.match(renderCiEvidenceMarkdown(summary), /Exact candidate SHA/u);
}

{
  const report = source("mad4b.e2e-phase-evaluation.v1", { findings: [] });
  delete report.candidate_sha;
  const summary = summaryFor({ "e2e-phase-evaluation.json": report }, { ...CONTEXT, executeResult: "skipped" });
  assert.equal(summary.outcome, "evidence_error");
  assert(summary.integrity_findings.some((finding) => finding.code === "source_report_candidate_sha_invalid"));
}

{
  const summary = summaryFor({
    "e2e-phase-evaluation.json": source("mad4b.e2e-phase-evaluation.v1", { candidate_sha: "b".repeat(40), findings: [] })
  }, { ...CONTEXT, executeResult: "skipped" });
  assert(summary.integrity_findings.some((finding) => finding.code === "source_report_candidate_sha_mismatch"));
}

{
  const summary = summaryFor({
    "e2e-phase-evaluation.json": source("wrong.contract", { findings: [] })
  }, { ...CONTEXT, executeResult: "skipped" });
  assert(summary.integrity_findings.some((finding) => finding.code === "source_report_contract_invalid"));
}

{
  const report = source("mad4b.e2e-phase-evaluation.v1", { findings: [] });
  delete report.secrets_included;
  const summary = summaryFor({ "e2e-phase-evaluation.json": report }, { ...CONTEXT, executeResult: "skipped" });
  assert(summary.integrity_findings.some((finding) => finding.code === "source_report_no_secret_declaration_invalid"));
}

{
  const summary = summaryFor({
    "unexpected.json": source("mad4b.unexpected.v1")
  }, { ...CONTEXT, executeResult: "skipped" });
  assert(summary.integrity_findings.some((finding) => finding.code === "unexpected_structured_report"));
}

{
  const summary = summaryFor({}, CONTEXT);
  assert.equal(summary.outcome, "evidence_error");
  assert.equal(summary.routing.consult_job_logs, true);
  assert(summary.integrity_findings.some((finding) => finding.code === "canonical_source_reports_missing"));
}


{
  const root = tempDir();
  const certRoot = tempDir();
  try {
    write(root, "e2e-phase-evaluation.json", source("mad4b.e2e-phase-evaluation.v1", { findings: [] }));
    write(root, "e2e-phase-execution.json", source("mad4b.e2e-phase-execution.v1", { results: [] }));
    const certPath = path.join(certRoot, "mariadb-certification.json");
    write(certRoot, "mariadb-certification.json", {
      report_type: "local_manager_desktop_command_mariadb_certification",
      ok: true,
      mode: "disposable",
      migration_sha256: "b".repeat(64),
      lifecycle: { atomic_claim: true, terminal_rewrite_rejected: true },
      privilege_denials: [{ label: "delete", denied: true }],
      production_authorized: false,
      staging_apply_authorized: false,
      secrets_included: false
    });
    const reportText = fs.readFileSync(certPath, "utf8");
    const expectedDigest = (await import("node:crypto")).createHash("sha256").update(reportText).digest("hex");
    const summary = buildCiEvidenceSummary({
      inputDir: root,
      context: { ...CONTEXT, mariadbCertificationResult: "success", mariadbCertificationEvidencePath: certPath }
    });
    assert.equal(summary.outcome, "passed");
    assert.equal(summary.jobs.mariadb_certification, "success");
    assert.equal(summary.certifications.local_manager_desktop_command_mariadb.evidence_sha256, expectedDigest);
    assert.match(renderCiEvidenceMarkdown(summary), /MariaDB evidence SHA-256/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

{
  const summary = summaryFor({
    "e2e-phase-evaluation.json": source("mad4b.e2e-phase-evaluation.v1", { findings: [] }),
    "e2e-phase-execution.json": source("mad4b.e2e-phase-execution.v1", { results: [] })
  }, { ...CONTEXT, mariadbCertificationResult: "success", mariadbCertificationEvidencePath: "/missing/certification.json" });
  assert.equal(summary.outcome, "evidence_error");
  assert(summary.integrity_findings.some((finding) => finding.code === "successful_mariadb_certification_missing_evidence"));
}

console.log(JSON.stringify({ ok: true, tests: 9, contract: "mad4b.ci-evidence-summary.v1", secrets_included: false }));
