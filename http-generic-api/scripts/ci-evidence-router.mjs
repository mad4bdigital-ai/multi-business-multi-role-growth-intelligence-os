#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOURCE_CONTRACTS } from "./ci-evidence-source-stamp.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CANDIDATE_KINDS = new Set(["head", "merge_candidate"]);
const SOURCE_DEFINITIONS = Object.freeze({
  "e2e-parallel-work-evaluation.json": Object.freeze({ contract: SOURCE_CONTRACTS["e2e-parallel-work-evaluation.json"], role: "evaluation", type: "parallel_evaluation" }),
  "e2e-phase-evaluation.json": Object.freeze({ contract: SOURCE_CONTRACTS["e2e-phase-evaluation.json"], role: "evaluation", type: "phase_evaluation" }),
  "e2e-parallel-execution.json": Object.freeze({ contract: SOURCE_CONTRACTS["e2e-parallel-execution.json"], role: "execution", type: "parallel_execution" }),
  "e2e-phase-execution.json": Object.freeze({ contract: SOURCE_CONTRACTS["e2e-phase-execution.json"], role: "execution", type: "phase_execution" })
});

const DEFAULT_POLICY = Object.freeze({
  schema_version: 1,
  policy_key: "ci_evidence_routing",
  authority_order: Object.freeze(["canonical_summary", "structured_source_reports", "workflow_job_status", "job_logs"]),
  job_logs_authority: "diagnostic_only",
  log_access_conditions: Object.freeze([
    "canonical_summary_missing_or_malformed",
    "structured_report_integrity_failure",
    "structured_report_marks_log_diagnosis_required",
    "bounded_redacted_diagnostic_is_insufficient_for_root_cause"
  ])
});

function parseArgs(argv) {
  const options = {
    inputDir: null,
    policyFile: null,
    jsonOutput: null,
    markdownOutput: null,
    stepSummary: process.env.GITHUB_STEP_SUMMARY || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId: process.env.GITHUB_RUN_ID || null,
    candidateKind: process.env.CI_CANDIDATE_KIND || null,
    candidateSha: process.env.CI_CANDIDATE_SHA || null,
    sourceHeadSha: process.env.CI_SOURCE_HEAD_SHA || null,
    headRef: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
    baseRef: process.env.GITHUB_BASE_REF || null,
    evaluateResult: process.env.EVALUATE_JOB_RESULT || null,
    executeResult: process.env.EXECUTE_JOB_RESULT || null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--input-dir") options.inputDir = read();
    else if (arg.startsWith("--input-dir=")) options.inputDir = arg.slice(12);
    else if (arg === "--policy-file") options.policyFile = read();
    else if (arg.startsWith("--policy-file=")) options.policyFile = arg.slice(14);
    else if (arg === "--json-output") options.jsonOutput = read();
    else if (arg.startsWith("--json-output=")) options.jsonOutput = arg.slice(14);
    else if (arg === "--markdown-output") options.markdownOutput = read();
    else if (arg.startsWith("--markdown-output=")) options.markdownOutput = arg.slice(18);
    else if (arg === "--step-summary") options.stepSummary = read();
    else if (arg.startsWith("--step-summary=")) options.stepSummary = arg.slice(15);
    else if (arg === "--workflow") options.workflow = read();
    else if (arg.startsWith("--workflow=")) options.workflow = arg.slice(11);
    else if (arg === "--run-id") options.runId = read();
    else if (arg.startsWith("--run-id=")) options.runId = arg.slice(9);
    else if (arg === "--candidate-kind") options.candidateKind = read();
    else if (arg.startsWith("--candidate-kind=")) options.candidateKind = arg.slice(17);
    else if (arg === "--candidate-sha" || arg === "--commit-sha") options.candidateSha = read();
    else if (arg.startsWith("--candidate-sha=")) options.candidateSha = arg.slice(16);
    else if (arg.startsWith("--commit-sha=")) options.candidateSha = arg.slice(13);
    else if (arg === "--source-head-sha") options.sourceHeadSha = read();
    else if (arg.startsWith("--source-head-sha=")) options.sourceHeadSha = arg.slice(18);
    else if (arg === "--head-ref") options.headRef = read();
    else if (arg.startsWith("--head-ref=")) options.headRef = arg.slice(11);
    else if (arg === "--base-ref") options.baseRef = read();
    else if (arg.startsWith("--base-ref=")) options.baseRef = arg.slice(11);
    else if (arg === "--evaluate-result") options.evaluateResult = read();
    else if (arg.startsWith("--evaluate-result=")) options.evaluateResult = arg.slice(18);
    else if (arg === "--execute-result") options.executeResult = read();
    else if (arg.startsWith("--execute-result=")) options.executeResult = arg.slice(17);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.inputDir) throw new Error("--input-dir is required.");
  if (!options.jsonOutput) throw new Error("--json-output is required.");
  if (!options.markdownOutput) throw new Error("--markdown-output is required.");
  if (!CANDIDATE_KINDS.has(options.candidateKind)) throw new Error("--candidate-kind must be head or merge_candidate.");
  if (!SHA_PATTERN.test(options.candidateSha || "")) throw new Error("--candidate-sha must be a full lowercase 40-character SHA.");
  if (options.sourceHeadSha && !SHA_PATTERN.test(options.sourceHeadSha)) throw new Error("--source-head-sha must be a full lowercase 40-character SHA.");
  return options;
}

function readPolicy(file) {
  if (!file) return DEFAULT_POLICY;
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  if (policy?.policy_key !== "ci_evidence_routing" || policy?.schema_version !== 1) throw new Error("Invalid CI evidence routing policy.");
  return policy;
}

function listJsonFiles(root) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) return [];
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(candidate);
    }
  };
  walk(resolved);
  return files.sort();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function collectReports(inputDir) {
  const reports = [];
  const malformed = [];
  for (const file of listJsonFiles(inputDir)) {
    const text = fs.readFileSync(file, "utf8");
    try {
      reports.push({ file, name: path.basename(file), digest: digest(text), data: JSON.parse(text) });
    } catch (error) {
      malformed.push({ name: path.basename(file), error: error.message || String(error) });
    }
  }
  return { reports, malformed };
}

function normalizedJobResult(value) {
  const result = String(value || "").toLowerCase();
  return ["success", "failure", "cancelled", "skipped"].includes(result) ? result : "unknown";
}

function diagnosticAvailable(failure) {
  return Boolean(failure?.diagnostic?.stderr?.tail || failure?.diagnostic?.stdout?.tail || failure?.error);
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function validateSource(report, context) {
  const definition = SOURCE_DEFINITIONS[report.name];
  const findings = [];
  if (!definition) return [{ code: "unexpected_structured_report", file: report.name }];
  if (report.data?.contract !== definition.contract) findings.push({ code: "source_report_contract_invalid", file: report.name, expected: definition.contract, actual: report.data?.contract ?? null });
  if (typeof report.data?.ok !== "boolean") findings.push({ code: "source_report_ok_missing", file: report.name });
  if (report.data?.secrets_included !== false) findings.push({ code: "source_report_no_secret_declaration_invalid", file: report.name, actual: report.data?.secrets_included ?? null });
  if (!CANDIDATE_KINDS.has(report.data?.candidate_kind)) findings.push({ code: "source_report_candidate_kind_invalid", file: report.name, actual: report.data?.candidate_kind ?? null });
  else if (report.data.candidate_kind !== context.candidateKind) findings.push({ code: "source_report_candidate_kind_mismatch", file: report.name, expected: context.candidateKind, actual: report.data.candidate_kind });
  if (!SHA_PATTERN.test(report.data?.candidate_sha || "")) findings.push({ code: "source_report_candidate_sha_invalid", file: report.name, actual: report.data?.candidate_sha ?? null });
  else if (report.data.candidate_sha !== context.candidateSha) findings.push({ code: "source_report_candidate_sha_mismatch", file: report.name, expected: context.candidateSha, actual: report.data.candidate_sha });
  return findings;
}

function firstEvaluationFinding(reports) {
  for (const report of reports.filter((row) => SOURCE_DEFINITIONS[row.name]?.role === "evaluation")) {
    const findings = Array.isArray(report.data?.findings) ? report.data.findings : [];
    if (findings.length) return { source: report.name, ...findings[0] };
    if (report.data?.ok === false) return { source: report.name, code: "evaluation_report_failed_without_finding" };
  }
  return null;
}

function failedExecutionResults(reports) {
  const failures = [];
  for (const report of reports.filter((row) => SOURCE_DEFINITIONS[row.name]?.role === "execution")) {
    const rows = Array.isArray(report.data?.results) ? report.data.results : [];
    for (const result of rows) if (result?.status !== "passed") failures.push({ source: report.name, ...result });
    if (!rows.length && report.data?.ok === false) failures.push({ source: report.name, status: "failed", error: "execution_report_failed_without_result" });
  }
  return failures;
}

export function buildCiEvidenceSummary({ inputDir, policy = DEFAULT_POLICY, context = {} }) {
  const { reports, malformed } = collectReports(inputDir);
  const evaluateJobResult = normalizedJobResult(context.evaluateResult);
  const executeJobResult = normalizedJobResult(context.executeResult);
  const integrityFindings = [];

  if (!reports.length) integrityFindings.push({ code: "canonical_source_reports_missing" });
  for (const item of malformed) integrityFindings.push({ code: "malformed_structured_report", file: item.name, error: item.error });
  for (const report of reports) integrityFindings.push(...validateSource(report, context));

  const recognized = reports.filter((report) => SOURCE_DEFINITIONS[report.name]);
  const evaluationReports = recognized.filter((report) => SOURCE_DEFINITIONS[report.name].role === "evaluation");
  const executionReports = recognized.filter((report) => SOURCE_DEFINITIONS[report.name].role === "execution");
  if (evaluateJobResult === "success" && !evaluationReports.length) integrityFindings.push({ code: "successful_evaluate_job_missing_report" });
  if (executeJobResult === "success" && !executionReports.length) integrityFindings.push({ code: "successful_execute_job_missing_report" });

  const evaluationFinding = firstEvaluationFinding(recognized);
  const executionFailures = failedExecutionResults(recognized);
  let outcome = "unknown";
  if (integrityFindings.length) outcome = "evidence_error";
  else if (evaluateJobResult === "failure" || evaluationFinding || evaluationReports.some((row) => row.data.ok === false)) outcome = "blocked";
  else if (executeJobResult === "failure" || executionFailures.length || executionReports.some((row) => row.data.ok === false)) outcome = "failed";
  else if (evaluateJobResult === "success" && ["success", "skipped"].includes(executeJobResult)) outcome = "passed";
  else if (recognized.length) outcome = "incomplete";

  const firstFailure = integrityFindings[0] || executionFailures[0] || evaluationFinding || null;
  const logDiagnosisRequired = outcome === "evidence_error" || (Boolean(firstFailure) && !diagnosticAvailable(firstFailure));
  const featureKeys = unique(recognized.flatMap((row) => [row.data?.feature_key, ...(row.data?.contracts || []).map((item) => item?.feature_key)]));

  return {
    contract: "mad4b.ci-evidence-summary.v1",
    generated_at: new Date().toISOString(),
    policy: {
      key: policy.policy_key,
      schema_version: policy.schema_version,
      authority_order: policy.authority_order,
      source_of_truth: "canonical_summary",
      structured_reports_role: "authoritative_inputs",
      workflow_job_status_role: "transport_and_completion_signal",
      job_logs_role: policy.job_logs_authority
    },
    identity: {
      workflow: context.workflow || null,
      run_id: context.runId || null,
      candidate_kind: context.candidateKind,
      candidate_sha: context.candidateSha,
      source_head_sha: context.sourceHeadSha || (context.candidateKind === "head" ? context.candidateSha : null),
      head_ref: context.headRef || null,
      base_ref: context.baseRef || null
    },
    outcome,
    jobs: { evaluate: evaluateJobResult, execute: executeJobResult },
    subject: {
      feature_keys: featureKeys,
      modes: unique(recognized.map((row) => row.data?.pr_mode || row.data?.mode)),
      workstream_ids: unique(recognized.map((row) => row.data?.workstream_id))
    },
    first_failure: firstFailure,
    integrity_findings: integrityFindings,
    source_reports: recognized.map((row) => ({
      name: row.name,
      contract: row.data.contract,
      type: SOURCE_DEFINITIONS[row.name].type,
      candidate_kind: row.data.candidate_kind,
      candidate_sha: row.data.candidate_sha,
      sha256: row.digest,
      ok: row.data.ok,
      secrets_included: row.data.secrets_included
    })),
    routing: {
      use_canonical_summary_first: true,
      consult_structured_source_reports_second: true,
      consult_job_logs: logDiagnosisRequired,
      job_logs_authority: policy.job_logs_authority,
      log_access_reason: logDiagnosisRequired ? (outcome === "evidence_error" ? "structured_evidence_missing_or_invalid" : "structured_failure_has_no_bounded_diagnostic") : null,
      allowed_log_access_conditions: policy.log_access_conditions
    },
    secrets_included: false
  };
}

function diagnosticTail(failure) {
  return failure?.diagnostic?.stderr?.tail || failure?.diagnostic?.stdout?.tail || failure?.error || null;
}

export function renderCiEvidenceMarkdown(summary) {
  const lines = [
    "# Canonical CI evidence report",
    "",
    `- Outcome: **${summary.outcome}**`,
    `- Workflow: \`${summary.identity.workflow || "unknown"}\``,
    `- Run: \`${summary.identity.run_id || "unknown"}\``,
    `- Candidate kind: \`${summary.identity.candidate_kind}\``,
    `- Exact candidate SHA: \`${summary.identity.candidate_sha}\``,
    `- Source head SHA: \`${summary.identity.source_head_sha || "not-applicable"}\``,
    `- Head/Base: \`${summary.identity.head_ref || "unknown"}\` → \`${summary.identity.base_ref || "unknown"}\``,
    "- Evidence authority: **canonical summary → structured reports → job status**",
    `- Job logs: **${summary.routing.consult_job_logs ? "diagnostic access required" : "not required"}** (${summary.routing.job_logs_authority})`,
    "",
    "## Decision",
    "",
    `- Evaluate job: **${summary.jobs.evaluate}**`,
    `- Execute job: **${summary.jobs.execute}**`,
    `- PR mode: ${summary.subject.modes.length ? summary.subject.modes.map((value) => `\`${value}\``).join(", ") : "—"}`,
    `- Feature: ${summary.subject.feature_keys.length ? summary.subject.feature_keys.map((value) => `\`${value}\``).join(", ") : "—"}`,
    `- Workstream: ${summary.subject.workstream_ids.length ? summary.subject.workstream_ids.map((value) => `\`${value}\``).join(", ") : "—"}`
  ];
  if (summary.first_failure) {
    const failure = summary.first_failure;
    lines.push("", "## First blocking evidence", "", `- Source: \`${failure.source || failure.file || "summary-integrity"}\``);
    if (failure.code) lines.push(`- Finding: \`${failure.code}\``);
    if (failure.test_id) lines.push(`- Test: \`${failure.test_id}\``);
    if (failure.status) lines.push(`- Status: \`${failure.status}\``);
    if (failure.exit_code != null) lines.push(`- Exit code: \`${failure.exit_code}\``);
    const tail = diagnosticTail(failure);
    if (tail) lines.push("", "<details><summary>Bounded redacted diagnostic</summary>", "", "```text", String(tail).slice(-4000), "```", "", "</details>");
  }
  if (summary.integrity_findings.length) {
    lines.push("", "## Evidence integrity findings", "");
    for (const finding of summary.integrity_findings) lines.push(`- \`${finding.code}\`${finding.file ? ` (${finding.file})` : ""}`);
  }
  lines.push("", "## Structured source reports", "", "| Report | Contract | Candidate | OK | SHA-256 |", "|---|---|---|---:|---|");
  if (!summary.source_reports.length) lines.push("| — | — | — | — | — |");
  for (const report of summary.source_reports) lines.push(`| \`${report.name}\` | \`${report.contract}\` | \`${report.candidate_kind}:${report.candidate_sha}\` | ${report.ok} | \`${report.sha256}\` |`);
  lines.push("", "## Routing rule", "");
  lines.push(summary.routing.consult_job_logs
    ? `Job logs may be opened only for \`${summary.routing.log_access_reason}\`. They remain diagnostic-only and cannot override a valid structured report.`
    : "Use this canonical report and its structured source reports. Do not read job logs or infer status from log snippets.");
  return `${lines.join("\n")}\n`;
}

function writeAtomic(file, content) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, resolved);
}

export function runCiEvidenceRouter(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const summary = buildCiEvidenceSummary({
    inputDir: options.inputDir,
    policy: readPolicy(options.policyFile),
    context: {
      workflow: options.workflow,
      runId: options.runId,
      candidateKind: options.candidateKind,
      candidateSha: options.candidateSha,
      sourceHeadSha: options.sourceHeadSha,
      headRef: options.headRef,
      baseRef: options.baseRef,
      evaluateResult: options.evaluateResult,
      executeResult: options.executeResult
    }
  });
  const markdown = renderCiEvidenceMarkdown(summary);
  writeAtomic(options.jsonOutput, `${JSON.stringify(summary, null, 2)}\n`);
  writeAtomic(options.markdownOutput, markdown);
  if (options.stepSummary) fs.appendFileSync(options.stepSummary, markdown);
  process.stdout.write(`${JSON.stringify({ contract: summary.contract, outcome: summary.outcome, candidate_kind: summary.identity.candidate_kind, candidate_sha: summary.identity.candidate_sha, consult_job_logs: summary.routing.consult_job_logs })}\n`);
  return summary.outcome === "evidence_error" ? 2 : 0;
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectExecution()) {
  try {
    process.exitCode = runCiEvidenceRouter();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  }
}
