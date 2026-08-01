#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const GOVERNED_REFRESH_DISPATCH_CONTRACT = "mad4b.governed-refresh-dispatch-evidence.v1";
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TARGET_REF_PATTERN = /^(?:gpt|cert|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;
const PROTECTED_BRANCHES = new Set(["main", "Production"]);
const DEFAULT_WORKFLOW = "governed-generated-artifact-refresh.yml";
const MAX_DIAGNOSTIC_CHARS = 4000;

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    values[key] = value;
    index += 1;
  }
  return values;
}

export function sanitizeDispatchDiagnostic(value = "") {
  return String(value)
    .replace(/\r/gu, "")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(authorization|token|secret|password|cookie|api[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]")
    .slice(-MAX_DIAGNOSTIC_CHARS);
}

function validateInputs({ repository, target_ref, expected_head_sha, workflow }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository || "")) {
    throw new Error("repository must use owner/name form.");
  }
  if (!TARGET_REF_PATTERN.test(target_ref || "") || PROTECTED_BRANCHES.has(target_ref)) {
    throw new Error("target_ref must be a governed non-protected work branch.");
  }
  if (!FULL_SHA_PATTERN.test(expected_head_sha || "")) {
    throw new Error("expected_head_sha must be an exact lowercase 40-character SHA.");
  }
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/u.test(workflow || "")) {
    throw new Error("workflow must be a workflow YAML filename.");
  }
}

function markdown(report) {
  const lines = [
    "# Governed generated-artifact refresh dispatch",
    "",
    `- Contract: \`${report.contract}\``,
    `- Outcome: **${report.outcome}**`,
    `- Repository: \`${report.repository}\``,
    `- Target ref: \`${report.target_ref}\``,
    `- Expected head SHA: \`${report.expected_head_sha}\``,
    `- Workflow: \`${report.workflow}\``,
    `- HTTP status: \`${report.http_status ?? "not-sent"}\``,
    "- Job logs: **diagnostic-only**",
    "- Secrets included: **no**",
  ];
  if (report.first_failure) {
    lines.push(
      "",
      "## First blocking finding",
      "",
      `- Code: \`${report.first_failure.code}\``,
      `- Diagnostic: \`${String(report.first_failure.diagnostic_tail || "").replace(/`/gu, "'")}\``,
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "governed-refresh-dispatch-evidence.json");
  const markdownPath = path.join(outputDir, "governed-refresh-dispatch-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(report));
  return { jsonPath, markdownPath };
}

export async function dispatchGovernedGeneratedArtifactRefresh({
  repository,
  target_ref,
  expected_head_sha,
  token,
  workflow = DEFAULT_WORKFLOW,
  output_dir,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = "https://api.github.com",
} = {}) {
  let firstFailure = null;
  let httpStatus = null;
  let requestId = null;

  try {
    validateInputs({ repository, target_ref, expected_head_sha, workflow });
    if (!token) throw new Error("GitHub token is required for workflow dispatch.");
    if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

    const response = await fetchImpl(
      `${apiBaseUrl.replace(/\/$/u, "")}/repos/${repository}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            target_ref,
            expected_head_sha,
            confirmation: "APPLY_GENERATED_ARTIFACT_REFRESH",
          },
        }),
      },
    );
    httpStatus = response.status;
    requestId = response.headers?.get?.("x-github-request-id") || null;
    const body = await response.text();
    if (response.status !== 204) {
      firstFailure = {
        code: "workflow_dispatch_rejected",
        diagnostic_tail: sanitizeDispatchDiagnostic(`HTTP ${response.status}: ${body || response.statusText || "dispatch rejected"}`),
      };
    }
  } catch (error) {
    firstFailure = {
      code: "workflow_dispatch_preflight_failed",
      diagnostic_tail: sanitizeDispatchDiagnostic(error?.message || String(error)),
    };
  }

  const report = {
    contract: GOVERNED_REFRESH_DISPATCH_CONTRACT,
    generated_at: new Date().toISOString(),
    outcome: firstFailure ? "blocked" : "passed",
    repository: repository || null,
    target_ref: target_ref || null,
    expected_head_sha: expected_head_sha || null,
    workflow,
    http_status: httpStatus,
    github_request_id: requestId,
    first_failure: firstFailure,
    dispatch: {
      event: "workflow_dispatch",
      workflow_ref: "main",
      typed_confirmation: "APPLY_GENERATED_ARTIFACT_REFRESH",
      mutation_delegated_to_registered_tool: true,
      protected_branch_mutation: false,
      force_push: false,
    },
    routing: {
      source_of_truth: "structured_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: false,
    },
    secrets_included: false,
  };
  const paths = writeReport(path.resolve(output_dir || path.join(process.cwd(), "artifacts", "governed-refresh-dispatch")), report);
  return { report, ...paths };
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  const result = await dispatchGovernedGeneratedArtifactRefresh({
    repository: args.repository || env.GITHUB_REPOSITORY,
    target_ref: args.target_ref || env.TARGET_REF,
    expected_head_sha: args.expected_head_sha || env.EXPECTED_HEAD_SHA,
    token: env.GITHUB_TOKEN || env.GH_TOKEN,
    workflow: args.workflow || DEFAULT_WORKFLOW,
    output_dir: args.output_dir || env.DISPATCH_REPORT_DIR,
  });
  const summary = {
    contract: result.report.contract,
    outcome: result.report.outcome,
    target_ref: result.report.target_ref,
    expected_head_sha: result.report.expected_head_sha,
    http_status: result.report.http_status,
    first_failure: result.report.first_failure?.code || null,
    secrets_included: false,
  };
  (result.report.outcome === "passed" ? process.stdout : process.stderr).write(`${JSON.stringify(summary)}\n`);
  return result.report.outcome === "passed" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    console.error(JSON.stringify({
      outcome: "blocked",
      first_failure: "dispatch_cli_failed",
      diagnostic_tail: sanitizeDispatchDiagnostic(error?.message || String(error)),
      secrets_included: false,
    }));
    process.exitCode = 1;
  }
}
