#!/usr/bin/env node
import { spawnSync as defaultSpawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RUNTIME_STARTUP_EVIDENCE_CONTRACT = "mad4b.runtime-startup-deployment-evidence.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CANDIDATE_KINDS = new Set(["head", "merge_candidate"]);
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "runtime-startup-deployment-evidence");
const MAX_DIAGNOSTIC_LINES = 80;
const MAX_DIAGNOSTIC_CHARS = 12_000;

export const DEFAULT_STAGES = Object.freeze([
  Object.freeze({
    id: "deployment_manifest_generator_test",
    label: "Validate deployment manifest generator",
    command: process.execPath,
    args: Object.freeze(["test-deployment-manifest-generator.mjs"])
  }),
  Object.freeze({
    id: "deployment_manifest_generation",
    label: "Generate deployment manifest",
    command: process.execPath,
    args: Object.freeze(["scripts/generate-deployment-manifest.mjs"])
  }),
  Object.freeze({
    id: "server_startup_smoke",
    label: "Prove server startup and deployment identity",
    command: process.execPath,
    args: Object.freeze(["test-server-startup-smoke.mjs"])
  })
]);

function parseArgs(argv) {
  const options = { outputDir: process.env.RUNTIME_STARTUP_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function cleanControlCharacters(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}

export function redactDiagnostic(value) {
  return cleanControlCharacters(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]")
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|cookie|secret)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]");
}

export function boundedDiagnosticTail(value, { maxLines = MAX_DIAGNOSTIC_LINES, maxChars = MAX_DIAGNOSTIC_CHARS } = {}) {
  const redacted = redactDiagnostic(value);
  const lines = redacted.split(/\r?\n/u);
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

function normalizeExitCode(result) {
  return Number.isInteger(result?.status) ? result.status : null;
}

function reportIdentity(env) {
  const candidateKind = env.CI_CANDIDATE_KIND || (env.GITHUB_EVENT_NAME === "pull_request" ? "merge_candidate" : "head");
  const candidateSha = env.CI_CANDIDATE_SHA || env.DEPLOYMENT_COMMIT_SHA || env.GITHUB_SHA || null;
  const sourceHeadSha = env.CI_SOURCE_HEAD_SHA || (candidateKind === "head" ? candidateSha : null);
  if (!CANDIDATE_KINDS.has(candidateKind)) throw new Error("CI_CANDIDATE_KIND must be head or merge_candidate.");
  if (!SHA_PATTERN.test(candidateSha || "")) throw new Error("CI_CANDIDATE_SHA must be a full lowercase 40-character SHA.");
  if (sourceHeadSha && !SHA_PATTERN.test(sourceHeadSha)) throw new Error("CI_SOURCE_HEAD_SHA must be a full lowercase 40-character SHA when supplied.");
  return {
    workflow: env.GITHUB_WORKFLOW || "CI",
    run_id: env.GITHUB_RUN_ID || null,
    candidate_kind: candidateKind,
    candidate_sha: candidateSha,
    source_head_sha: sourceHeadSha,
    head_ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.DEPLOYMENT_BRANCH || null,
    base_ref: env.GITHUB_BASE_REF || null
  };
}

function commandLabel(stage) {
  return [path.basename(stage.command), ...stage.args].join(" ");
}

function renderMarkdown(report) {
  const lines = [
    "# Runtime startup and deployment evidence",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Candidate kind: \`${report.identity.candidate_kind}\``,
    `- Exact candidate SHA: \`${report.identity.candidate_sha}\``,
    `- Source head SHA: \`${report.identity.source_head_sha || "not-applicable"}\``,
    `- Branch: \`${report.identity.head_ref || "unknown"}\``,
    `- Contract: \`${report.contract}\``,
    "- Job logs: diagnostic-only; the bounded structured report is the evidence source.",
    "",
    "## Stages",
    ""
  ];
  for (const stage of report.stages) {
    lines.push(`- ${stage.status === "passed" ? "PASS" : "FAIL"} \`${stage.id}\`: ${stage.label} (${stage.duration_ms} ms)`);
  }
  if (report.first_failure) {
    lines.push("", "## First failure", "", `- Stage: \`${report.first_failure.stage_id}\``, `- Exit code: \`${report.first_failure.exit_code ?? "none"}\``);
    if (report.first_failure.diagnostic?.stderr?.tail) {
      lines.push("", "### Redacted stderr tail", "", "```text", report.first_failure.diagnostic.stderr.tail, "```");
    } else if (report.first_failure.diagnostic?.stdout?.tail) {
      lines.push("", "### Redacted stdout tail", "", "```text", report.first_failure.diagnostic.stdout.tail, "```");
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(outputDir, report) {
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, "runtime-startup-deployment-evidence.json");
  const markdownPath = path.join(resolved, "runtime-startup-deployment-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

export function runRuntimeStartupDeploymentEvidence({
  outputDir = DEFAULT_OUTPUT_DIR,
  stages = DEFAULT_STAGES,
  spawnSync = defaultSpawnSync,
  env = process.env,
  cwd = process.cwd(),
  now = () => Date.now()
} = {}) {
  const identity = reportIdentity(env);
  const results = [];
  let firstFailure = null;

  for (const stage of stages) {
    const startedAt = now();
    const result = spawnSync(stage.command, [...stage.args], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    });
    const durationMs = Math.max(0, now() - startedAt);
    const exitCode = normalizeExitCode(result);
    const passed = exitCode === 0 && !result?.error;
    const diagnostic = passed ? null : {
      stdout: { tail: boundedDiagnosticTail(result?.stdout) },
      stderr: { tail: boundedDiagnosticTail(result?.stderr) }
    };
    const stageResult = {
      id: stage.id,
      label: stage.label,
      command: commandLabel(stage),
      status: passed ? "passed" : "failed",
      exit_code: exitCode,
      signal: result?.signal || null,
      duration_ms: durationMs,
      ...(result?.error ? { error: boundedDiagnosticTail(result.error.message || String(result.error), { maxLines: 20, maxChars: 2_000 }) } : {}),
      ...(diagnostic ? { diagnostic } : {})
    };
    results.push(stageResult);
    if (!passed) {
      firstFailure = {
        stage_id: stage.id,
        exit_code: exitCode,
        signal: result?.signal || null,
        ...(stageResult.error ? { error: stageResult.error } : {}),
        diagnostic
      };
      break;
    }
  }

  const report = {
    contract: RUNTIME_STARTUP_EVIDENCE_CONTRACT,
    generated_at: new Date().toISOString(),
    identity,
    outcome: firstFailure ? "failed" : "passed",
    stages: results,
    first_failure: firstFailure,
    routing: {
      source_of_truth: "structured_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: Boolean(firstFailure) && !firstFailure.diagnostic?.stderr?.tail && !firstFailure.diagnostic?.stdout?.tail,
      log_access_reason: Boolean(firstFailure) && !firstFailure.diagnostic?.stderr?.tail && !firstFailure.diagnostic?.stdout?.tail
        ? "bounded_structured_diagnostic_missing"
        : null
    },
    secrets_included: false
  };
  const paths = writeReport(outputDir, report);
  return { report, ...paths };
}

export function runCli(argv = process.argv.slice(2)) {
  const { outputDir } = parseArgs(argv);
  const result = runRuntimeStartupDeploymentEvidence({ outputDir });
  const summary = {
    ok: result.report.outcome === "passed",
    contract: result.report.contract,
    outcome: result.report.outcome,
    candidate_sha: result.report.identity.candidate_sha,
    first_failure: result.report.first_failure?.stage_id || null,
    report_file: result.jsonPath,
    secrets_included: false
  };
  const output = `${JSON.stringify(summary)}\n`;
  if (summary.ok) process.stdout.write(output);
  else process.stderr.write(output);
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: boundedDiagnosticTail(error?.message || String(error), { maxLines: 20, maxChars: 2_000 }),
      secrets_included: false
    }));
    process.exitCode = 1;
  }
}
