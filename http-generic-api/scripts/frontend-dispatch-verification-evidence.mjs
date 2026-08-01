#!/usr/bin/env node
import { spawnSync as defaultSpawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { boundedDiagnosticTail } from "./runtime-startup-deployment-evidence.mjs";

export const FRONTEND_DISPATCH_EVIDENCE_CONTRACT = "mad4b.frontend-dispatch-verification-evidence.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "frontend-dispatch-verification-evidence");

export const DEFAULT_FRONTEND_DISPATCH_STAGES = Object.freeze([
  Object.freeze({
    id: "workflow_baseline_contract",
    label: "Validate fetched canonical baseline semantics",
    command: process.execPath,
    args: Object.freeze(["test-frontend-dispatch-workflow-baseline.mjs"]),
  }),
  Object.freeze({
    id: "operation_governance_generator",
    label: "Validate operation governance generator",
    command: process.execPath,
    args: Object.freeze(["test-frontend-operation-governance-generator.mjs"]),
  }),
  Object.freeze({
    id: "frontend_surface_dispatch",
    label: "Validate frontend surface dispatch",
    command: process.execPath,
    args: Object.freeze(["test-frontend-surface-dispatch.mjs"]),
  }),
  Object.freeze({
    id: "frontend_auth_openapi_parity",
    label: "Validate frontend auth and OpenAPI parity",
    command: process.execPath,
    args: Object.freeze(["test-frontend-auth-openapi-parity.mjs"]),
  }),
  Object.freeze({
    id: "openapi_route_coverage",
    label: "Validate OpenAPI route coverage",
    command: process.execPath,
    args: Object.freeze(["test-openapi-route-coverage.mjs"]),
  }),
  Object.freeze({
    id: "openapi_auth_check",
    label: "Validate generated OpenAPI authentication projection",
    command: "npm",
    args: Object.freeze(["run", "openapi:auth:check"]),
  }),
]);

function parseArgs(argv) {
  const options = { outputDir: process.env.FRONTEND_DISPATCH_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--output-dir requires a value.");
      options.outputDir = value;
      index += 1;
    } else if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function identityFromEnv(env) {
  const candidateKind = env.CI_CANDIDATE_KIND || (env.GITHUB_EVENT_NAME === "pull_request" ? "merge_candidate" : "head");
  const candidateSha = env.CI_CANDIDATE_SHA || env.GITHUB_SHA || null;
  const sourceHeadSha = env.CI_SOURCE_HEAD_SHA || (candidateKind === "head" ? candidateSha : null);
  if (!["head", "merge_candidate"].includes(candidateKind)) throw new Error("CI_CANDIDATE_KIND must be head or merge_candidate.");
  if (!SHA_PATTERN.test(candidateSha || "")) throw new Error("CI_CANDIDATE_SHA must be a full lowercase 40-character SHA.");
  if (sourceHeadSha && !SHA_PATTERN.test(sourceHeadSha)) throw new Error("CI_SOURCE_HEAD_SHA must be a full lowercase 40-character SHA when supplied.");
  return {
    workflow: env.GITHUB_WORKFLOW || "Frontend surface dispatch",
    run_id: env.GITHUB_RUN_ID || null,
    candidate_kind: candidateKind,
    candidate_sha: candidateSha,
    source_head_sha: sourceHeadSha,
    head_ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
    base_ref: env.GITHUB_BASE_REF || null,
  };
}

function commandLabel(stage) {
  return [path.basename(stage.command), ...stage.args].join(" ");
}

function renderMarkdown(report) {
  const lines = [
    "# Frontend dispatch verification evidence",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Exact candidate SHA: \`${report.identity.candidate_sha}\``,
    `- Source head SHA: \`${report.identity.source_head_sha || "not-applicable"}\``,
    `- Contract: \`${report.contract}\``,
    "- Job logs: diagnostic-only; the structured report is the evidence source.",
    "",
    "## Verification stages",
    "",
  ];
  for (const stage of report.stages) {
    lines.push(`- ${stage.status === "passed" ? "PASS" : "FAIL"} \`${stage.id}\`: ${stage.label} (${stage.duration_ms} ms)`);
  }
  if (report.first_failure) {
    lines.push("", "## First failure", "", `- Stage: \`${report.first_failure.stage_id}\``, `- Exit code: \`${report.first_failure.exit_code ?? "none"}\``);
    const diagnostic = report.first_failure.diagnostic?.stderr?.tail || report.first_failure.diagnostic?.stdout?.tail;
    if (diagnostic) lines.push("", "```text", diagnostic, "```");
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(outputDir, report) {
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, "frontend-dispatch-verification-evidence.json");
  const markdownPath = path.join(resolved, "frontend-dispatch-verification-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

export function runFrontendDispatchVerificationEvidence({
  outputDir = DEFAULT_OUTPUT_DIR,
  stages = DEFAULT_FRONTEND_DISPATCH_STAGES,
  spawnSync = defaultSpawnSync,
  env = process.env,
  cwd = process.cwd(),
  now = () => Date.now(),
} = {}) {
  const identity = identityFromEnv(env);
  const results = [];
  let firstFailure = null;

  for (const stage of stages) {
    const startedAt = now();
    const result = spawnSync(stage.command, [...stage.args], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const durationMs = Math.max(0, now() - startedAt);
    const exitCode = Number.isInteger(result?.status) ? result.status : null;
    const passed = exitCode === 0 && !result?.error;
    const stageResult = {
      id: stage.id,
      label: stage.label,
      command: commandLabel(stage),
      status: passed ? "passed" : "failed",
      exit_code: exitCode,
      signal: result?.signal || null,
      duration_ms: durationMs,
    };
    if (!passed) {
      stageResult.diagnostic = {
        stdout: { tail: boundedDiagnosticTail(result?.stdout) },
        stderr: { tail: boundedDiagnosticTail(result?.stderr) },
      };
      if (result?.error) stageResult.error = boundedDiagnosticTail(result.error.message || String(result.error), { maxLines: 20, maxChars: 2_000 });
      firstFailure = {
        stage_id: stage.id,
        exit_code: exitCode,
        signal: result?.signal || null,
        diagnostic: stageResult.diagnostic,
        ...(stageResult.error ? { error: stageResult.error } : {}),
      };
    }
    results.push(stageResult);
    if (!passed) break;
  }

  const hasDiagnostic = Boolean(firstFailure?.diagnostic?.stderr?.tail || firstFailure?.diagnostic?.stdout?.tail || firstFailure?.error);
  const report = {
    contract: FRONTEND_DISPATCH_EVIDENCE_CONTRACT,
    generated_at: new Date().toISOString(),
    identity,
    outcome: firstFailure ? "failed" : "passed",
    stages: results,
    first_failure: firstFailure,
    routing: {
      source_of_truth: "structured_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: Boolean(firstFailure) && !hasDiagnostic,
      log_access_reason: Boolean(firstFailure) && !hasDiagnostic ? "bounded_structured_diagnostic_missing" : null,
    },
    secrets_included: false,
  };
  return { report, ...writeReport(outputDir, report) };
}

export function runCli(argv = process.argv.slice(2)) {
  const { outputDir } = parseArgs(argv);
  const result = runFrontendDispatchVerificationEvidence({ outputDir });
  const ok = result.report.outcome === "passed";
  const summary = {
    ok,
    contract: result.report.contract,
    outcome: result.report.outcome,
    candidate_sha: result.report.identity.candidate_sha,
    first_failure: result.report.first_failure?.stage_id || null,
    report_file: result.jsonPath,
    secrets_included: false,
  };
  (ok ? process.stdout : process.stderr).write(`${JSON.stringify(summary)}\n`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: boundedDiagnosticTail(error?.message || String(error), { maxLines: 20, maxChars: 2_000 }),
      secrets_included: false,
    }));
    process.exitCode = 1;
  }
}
