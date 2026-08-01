#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT = "mad4b.pr-generated-artifact-refresh-summary.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_DIAGNOSTIC_CHARS = 4000;
export const ALLOWED_GENERATED_ARTIFACT_PATHS = Object.freeze([
  "http-generic-api/openapi.yaml",
  "http-generic-api/frontend-operation-governance.generated.json",
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.activation-admin.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.auth.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.activation.yaml",
  "http-generic-api/openapi.gpt-action.local-connector.yaml",
]);
const ALLOWED_CHANGED_FILES = new Set(ALLOWED_GENERATED_ARTIFACT_PATHS);
const scriptPath = fileURLToPath(import.meta.url);
const apiDir = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(apiDir, "..");

function sanitize(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "[redacted-github-token]")
    .slice(-MAX_DIAGNOSTIC_CHARS);
}

class StepFailure extends Error {
  constructor({ code, step, command, status, stdout, stderr }) {
    super(`${step} failed${Number.isInteger(status) ? ` with status ${status}` : ""}`);
    this.code = code;
    this.step = step;
    this.command = command;
    this.status = status;
    this.stdout = sanitize(stdout);
    this.stderr = sanitize(stderr);
  }
}

function run(step, command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new StepFailure({
      code: options.failureCode || `${step}_failed`,
      step,
      command: [command, ...args].join(" "),
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr || result.error?.message,
    });
  }
  return result;
}

function parseChangedFiles() {
  const result = run("inspect_write_set", "git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot });
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
}

function writeReport(reportPath, markdownPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const first = report.first_failure;
  const lines = [
    "# PR Generated Artifact Refresh",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Exact candidate SHA: \`${report.identity.candidate_sha}\``,
    `- Contract: \`${report.contract}\``,
    `- Generated drift files: **${report.generated_artifacts.changed_files.length}**`,
    "- Repository mutation: **none (read-only PR evaluation)**",
    "- Evidence authority: **canonical summary → workflow status**",
    "- Job logs: **diagnostic-only**",
  ];
  if (first) {
    lines.push(
      "",
      "## First blocking finding",
      "",
      `- Code: \`${first.code}\``,
      `- Step: \`${first.step}\``,
      `- Command: \`${String(first.command || "unknown").replace(/`/gu, "'")}\``,
      `- Exit status: \`${first.exit_status ?? "unknown"}\``,
      `- Bounded stderr: \`${String(first.stderr_tail || "").replace(/`/gu, "'")}\``,
      `- Bounded stdout: \`${String(first.stdout_tail || "").replace(/`/gu, "'")}\``,
    );
  }
  const markdown = `${lines.join("\n")}\n`;
  fs.writeFileSync(markdownPath, markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

export function runGeneratedArtifactRefreshEvaluation() {
  const reportPath = process.env.REPORT_PATH || path.join(process.env.RUNNER_TEMP || repoRoot, "pr-generated-artifact-refresh-summary.json");
  const markdownPath = process.env.REPORT_MARKDOWN_PATH || path.join(process.env.RUNNER_TEMP || repoRoot, "pr-generated-artifact-refresh-summary.md");
  const sourceHeadSha = process.env.CI_SOURCE_HEAD_SHA || "unknown";
  const headRef = process.env.TARGET_REF || process.env.GITHUB_HEAD_REF || "unknown";
  let changedFiles = [];
  let firstFailure = null;

  try {
    if (!SHA_PATTERN.test(sourceHeadSha)) {
      throw new StepFailure({ code: "source_head_sha_invalid", step: "identity", command: "validate source head SHA", status: null });
    }
    run("install_dependencies", "npm", ["ci"], { cwd: apiDir, failureCode: "npm_ci_failed" });
    run("fetch_main", "git", ["fetch", "origin", "main", "--depth=1"], { cwd: repoRoot });
    run("sync_precise_registry", "node", ["scripts/openapi-precise-contract-registry-sync.mjs", "--write"], { cwd: apiDir });
    run("autofill_openapi_routes", "node", ["scripts/openapi-autofill-missing-routes.mjs", "--write"], { cwd: apiDir });
    run("generate_frontend_dispatch", "npm", ["run", "frontend:dispatch:generate", "--", "--baseline-ref=main"], { cwd: apiDir });
    run("generate_custom_gpt_schemas", "node", ["scripts/generate-custom-gpt-schemas.mjs", "--write"], { cwd: apiDir });

    const verificationCommands = [
      ["verify_openapi_autofill", "node", ["test-openapi-autofill-missing-routes.mjs"]],
      ["verify_frontend_governance", "node", ["test-frontend-operation-governance-generator.mjs"]],
      ["verify_frontend_dispatch", "node", ["test-frontend-surface-dispatch.mjs"]],
      ["verify_auth_parity", "node", ["test-frontend-auth-openapi-parity.mjs"]],
      ["verify_openapi_route_coverage", "node", ["test-openapi-route-coverage.mjs"]],
      ["verify_openapi_auth", "npm", ["run", "openapi:auth:check"]],
      ["verify_schema_guard", "npm", ["run", "schemas:guard"]],
    ];
    for (const [step, command, args] of verificationCommands) run(step, command, args, { cwd: apiDir });

    changedFiles = parseChangedFiles();
    const unexpected = changedFiles.filter((file) => !ALLOWED_CHANGED_FILES.has(file));
    if (unexpected.length) {
      throw new StepFailure({
        code: "generated_artifact_write_set_violation",
        step: "enforce_write_set",
        command: "validate generated artifact paths",
        status: 1,
        stdout: unexpected.join("\n"),
        stderr: "Generator changed files outside the bounded artifact set.",
      });
    }
    if (changedFiles.length) {
      throw new StepFailure({
        code: "generated_artifact_drift_detected",
        step: "compare_generated_artifacts",
        command: "git status --porcelain --untracked-files=all",
        status: 1,
        stdout: changedFiles.join("\n"),
        stderr: "Run the registered governed generated-artifact refresh tool with the exact target ref and expected head SHA.",
      });
    }
  } catch (error) {
    const failure = error instanceof StepFailure
      ? error
      : new StepFailure({ code: "refresh_unhandled_failure", step: "unhandled", command: "unknown", status: null, stderr: error?.stack || error?.message || String(error) });
    firstFailure = {
      code: failure.code,
      step: failure.step,
      command: failure.command,
      exit_status: Number.isInteger(failure.status) ? failure.status : null,
      stderr_tail: failure.stderr || "",
      stdout_tail: failure.stdout || "",
      secrets_included: false,
    };
  }

  const report = {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    identity: {
      workflow: "PR Generated Artifact Refresh",
      run_id: Number(process.env.GITHUB_RUN_ID || 0),
      candidate_kind: "head",
      candidate_sha: sourceHeadSha,
      source_head_sha: sourceHeadSha,
      head_ref: headRef,
      base_ref: process.env.GITHUB_BASE_REF || "main",
    },
    outcome: firstFailure ? "blocked" : "passed",
    first_failure: firstFailure,
    generated_artifacts: {
      changed_files: changedFiles,
      commit_sha: null,
      target_ref: headRef,
      source_head_sha: sourceHeadSha,
      repository_mutation_performed: false,
    },
    routing: {
      source_of_truth: "canonical_summary",
      workflow_job_status_role: "transport_and_completion_signal",
      job_logs_role: "diagnostic_only",
      consult_job_logs: false,
    },
    secrets_included: false,
  };
  writeReport(reportPath, markdownPath, report);
  process.stdout.write(`${JSON.stringify({ contract: report.contract, outcome: report.outcome, candidate_sha: sourceHeadSha, first_failure: firstFailure?.code || null, secrets_included: false })}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runGeneratedArtifactRefreshEvaluation();
}
