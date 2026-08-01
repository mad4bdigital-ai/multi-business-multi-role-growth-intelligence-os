#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROUTING_CONTRACT = "mad4b.github-actions-evidence-routing-report.v1";
const SUMMARY_CONTRACT = "mad4b.test-diagnostic-summary.v2";
const COMMENT_MARKER = "<!-- mad4b-branch-test-diagnostic-evidence-router:v1 -->";

function parseArgs(argv) {
  const options = {
    eventFile: process.env.GITHUB_EVENT_PATH || null,
    summaryFile: null,
    outputJson: "diagnostic-evidence-routing.json",
    outputMarkdown: "diagnostic-evidence-routing.md",
  };

  const readValue = (name, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event-file") {
      options.eventFile = readValue(arg, index);
      index += 1;
    } else if (arg.startsWith("--event-file=")) {
      options.eventFile = arg.slice("--event-file=".length);
    } else if (arg === "--summary-file") {
      options.summaryFile = readValue(arg, index);
      index += 1;
    } else if (arg.startsWith("--summary-file=")) {
      options.summaryFile = arg.slice("--summary-file=".length);
    } else if (arg === "--output-json") {
      options.outputJson = readValue(arg, index);
      index += 1;
    } else if (arg.startsWith("--output-json=")) {
      options.outputJson = arg.slice("--output-json=".length);
    } else if (arg === "--output-markdown") {
      options.outputMarkdown = readValue(arg, index);
      index += 1;
    } else if (arg.startsWith("--output-markdown=")) {
      options.outputMarkdown = arg.slice("--output-markdown=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.eventFile) throw new Error("--event-file or GITHUB_EVENT_PATH is required.");
  return options;
}

function readJson(file, { optional = false } = {}) {
  if (!file || !existsSync(file)) {
    if (optional) return null;
    throw new Error(`JSON file not found: ${file}`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizedSha(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
}

function firstFailure(summary) {
  if (Array.isArray(summary?.failures) && summary.failures.length) return summary.failures[0];
  return summary?.sequentialManifest?.firstFailure || summary?.sequentialSuite?.firstFailure || null;
}

function buildDecision(summaryState, summary) {
  if (summaryState.code === "summary_missing") {
    return {
      status: "blocked",
      code: "diagnostic_summary_unavailable",
      nextAction: "repair_or_rerun_summary_production_before_claiming_branch_test_outcome",
      jobLogsMayBeReadFor: ["summary_artifact_production_failure"],
    };
  }

  if (summaryState.code !== "valid") {
    return {
      status: "blocked",
      code: "diagnostic_summary_invalid",
      nextAction: "repair_summary_contract_or_identity_mismatch_before_claiming_branch_test_outcome",
      jobLogsMayBeReadFor: ["summary_contract_or_artifact_production_failure"],
    };
  }

  const passed = Number(summary.failedCount || 0) === 0
    && summary.sequentialJobResult === "success"
    && summary.sequentialSuite?.status === "passed"
    && summary.sequentialManifest?.status === "passed";

  if (passed) {
    return {
      status: "passed",
      code: "branch_test_diagnostic_passed",
      nextAction: "do_not_read_job_logs_for_branch_test_outcome; evaluate_other_failed_workflows_from_their_own_reports",
      jobLogsMayBeReadFor: [],
    };
  }

  return {
    status: "failed",
    code: "branch_test_diagnostic_failed",
    nextAction: "use_reported_failure_and_rerun_coordinates_then_open_only_the_corresponding_job_log_if_needed",
    jobLogsMayBeReadFor: ["exact_failure_reported_by_summary"],
  };
}

function validateSummary(summary, event) {
  if (!summary) return { code: "summary_missing", reasons: ["diagnostic-summary.json was not downloaded"] };

  const reasons = [];
  const run = event.workflow_run || {};
  const pullRequest = Array.isArray(run.pull_requests) ? run.pull_requests[0] : null;
  const repository = event.repository?.full_name || null;

  if (summary.contract !== SUMMARY_CONTRACT) reasons.push(`contract must equal ${SUMMARY_CONTRACT}`);
  if (repository && summary.repository !== repository) reasons.push("summary repository does not match workflow_run repository");
  if (pullRequest?.number && summary.ref !== `refs/pull/${pullRequest.number}/merge`) {
    reasons.push("summary ref does not match the pull request merge ref");
  }
  if (!normalizedSha(summary.commitSha)) reasons.push("summary commitSha is not a full tested merge SHA");
  if (summary.secretsIncluded !== false) reasons.push("summary must declare secretsIncluded=false");

  return reasons.length ? { code: "summary_invalid", reasons } : { code: "valid", reasons: [] };
}

export function buildEvidenceRoutingReport(event, summary, generatedAt = new Date().toISOString()) {
  const run = event.workflow_run || {};
  const pullRequest = Array.isArray(run.pull_requests) ? run.pull_requests[0] : null;
  const summaryState = validateSummary(summary, event);
  const decision = buildDecision(summaryState, summary);
  const failure = firstFailure(summary);

  return {
    contract: ROUTING_CONTRACT,
    generatedAt,
    repository: event.repository?.full_name || summary?.repository || null,
    pullRequestNumber: pullRequest?.number || null,
    sourceWorkflow: {
      name: run.name || null,
      runId: run.id || null,
      runNumber: run.run_number || null,
      runAttempt: run.run_attempt || null,
      event: run.event || null,
      status: run.status || null,
      conclusion: run.conclusion || null,
      url: run.html_url || null,
    },
    testedRefs: {
      headRef: pullRequest?.head?.ref || run.head_branch || summary?.sequentialManifest?.headRef || null,
      headSha: normalizedSha(pullRequest?.head?.sha || run.head_sha),
      baseRef: pullRequest?.base?.ref || summary?.sequentialManifest?.baseRef || null,
      baseSha: normalizedSha(pullRequest?.base?.sha),
      testedRef: summary?.ref || null,
      testedMergeSha: normalizedSha(summary?.commitSha),
    },
    summaryValidation: summaryState,
    authorities: {
      branchTestOutcome: "diagnostic_summary_artifact",
      exactRunIdentity: "workflow_run_event",
      overallCheckState: "github_check_conclusion",
      jobStepSummary: "supporting_human_readable_projection",
      jobLogs: "diagnostic_only_not_outcome_authority",
    },
    evidencePriority: [
      "diagnostic-evidence-routing.json",
      "diagnostic-summary.json",
      "diagnostic-summary.md",
      "GitHub check conclusion for the exact run",
      "job step summary",
      "bounded job log for an exact report-identified failure only",
    ],
    conflictRule: "For the exact source run and tested merge SHA, a valid diagnostic summary artifact is authoritative for Branch Test Diagnostic outcomes. Job-log prose cannot override it.",
    scopeRule: "A passing Branch Test Diagnostic report proves only that workflow's test catalog. A different failed workflow must be evaluated from its own authoritative report or check contract.",
    diagnosticSummary: summaryState.code === "valid" ? {
      contract: summary.contract,
      generatedAt: summary.generatedAt || null,
      familyCount: Number(summary.familyCount || 0),
      reportCount: Number(summary.reportCount || 0),
      selectedCount: Number(summary.selectedCount || 0),
      passedCount: Number(summary.passedCount || 0),
      failedCount: Number(summary.failedCount || 0),
      sequentialJobResult: summary.sequentialJobResult || null,
      sequentialSuiteStatus: summary.sequentialSuite?.status || null,
      sequentialManifestStatus: summary.sequentialManifest?.status || null,
      firstFailure: failure,
    } : null,
    decision,
    secretsIncluded: false,
  };
}

function quote(value) {
  return value == null || value === "" ? "—" : `\`${String(value)}\``;
}

export function renderEvidenceRoutingMarkdown(report) {
  const lines = [
    COMMENT_MARKER,
    "## Branch Test Diagnostic evidence",
    "",
    `- Decision: **${report.decision.status}** (\`${report.decision.code}\`)`,
    `- Source run: ${quote(report.sourceWorkflow.runId)} · attempt ${quote(report.sourceWorkflow.runAttempt)}`,
    `- Pull request: ${report.pullRequestNumber ? `#${report.pullRequestNumber}` : "—"}`,
    `- Head: ${quote(report.testedRefs.headRef)} at ${quote(report.testedRefs.headSha)}`,
    `- Base: ${quote(report.testedRefs.baseRef)} at ${quote(report.testedRefs.baseSha)}`,
    `- Tested merge ref: ${quote(report.testedRefs.testedRef)} at ${quote(report.testedRefs.testedMergeSha)}`,
    "",
    "### Evidence authority",
    "",
    "1. This routing report and the exact-run `diagnostic-summary.json` are authoritative for Branch Test Diagnostic outcomes.",
    "2. GitHub check conclusions establish the exact workflow/check state.",
    "3. Job step summaries are supporting projections.",
    "4. Job logs are diagnostic-only and must be opened only for an exact failure named by the report, or when report production itself failed.",
    "5. A passing diagnostic report does not override a different failed workflow; use that workflow's own report or check contract.",
    "",
    `Next action: \`${report.decision.nextAction}\``,
  ];

  if (report.summaryValidation.code !== "valid") {
    lines.push("", "### Report validation", "");
    for (const reason of report.summaryValidation.reasons) lines.push(`- ${reason}`);
  } else {
    const summary = report.diagnosticSummary;
    lines.push(
      "",
      "### Test summary",
      "",
      `- Families: **${summary.familyCount}**`,
      `- Reports: **${summary.reportCount}**`,
      `- Tests selected: **${summary.selectedCount}**`,
      `- Tests passed: **${summary.passedCount}**`,
      `- Failures: **${summary.failedCount}**`,
      `- Sequential suite: **${summary.sequentialSuiteStatus}**`,
      `- Sequential manifest: **${summary.sequentialManifestStatus}**`,
    );

    if (summary.firstFailure) {
      lines.push("", "### First reported failure", "", "```json", JSON.stringify(summary.firstFailure, null, 2), "```");
    }
  }

  lines.push("", "_Do not infer branch-test failure or success by reading unrelated Job logs._", "");
  return lines.join("\n");
}

function writeText(file, content) {
  const resolved = path.resolve(file);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const event = readJson(options.eventFile);
  const summary = readJson(options.summaryFile, { optional: true });
  const report = buildEvidenceRoutingReport(event, summary);
  const markdown = renderEvidenceRoutingMarkdown(report);
  writeText(options.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  writeText(options.outputMarkdown, `${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
  process.stdout.write(`${JSON.stringify({ decision: report.decision, pullRequestNumber: report.pullRequestNumber })}\n`);
  return report.decision.status === "blocked" ? 2 : 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectExecution()) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
