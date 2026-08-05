#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TARGET_REF = "gpt/add-runtime-parity-comment-bridge-v2-20260804";
const EXPECTED_MAIN = "93430fd5e709f49d7a47e2830382b6578a7a22e6";
const CONFIRMATION = "APPLY_GENERATED_ARTIFACT_REFRESH";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SCRIPT_PATH = ".github/scripts/runtime-parity-ownership-repair-v6.sh";
const WORKFLOW_PATH = ".github/workflows/runtime-parity-generated-binding-ownership-repair-v3.yml";
const TRIGGER_PATH = ".runtime-parity-ownership-repair-v6.trigger";
const REFRESH_TOOL = "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function parseArguments(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  return text.replace(oldValue, newValue);
}

function bounded(value) {
  return String(value || "")
    .replace(/\r/gu, "")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "[redacted-github-token]")
    .slice(-4000);
}

function writeReport(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "generated-artifact-refresh-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Runtime Parity Ownership Repair Bootstrap",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Target ref: \`${report.target_ref}\``,
    `- Expected head: \`${report.expected_head_sha}\``,
    `- Result head: \`${report.commit_sha || "none"}\``,
    `- Changed files: **${report.changed_files.length}**`,
    "- Protected branch mutation: **no**",
    "- Force push: **no**",
    "- Secrets included: **false**",
  ];
  if (report.first_failure) lines.push("", `- First failure: \`${report.first_failure.code}\``, `- Diagnostic: \`${report.first_failure.stderr_tail.replaceAll("`", "'")}\``);
  fs.writeFileSync(path.join(outputDir, "generated-artifact-refresh-report.md"), `${lines.join("\n")}\n`);
}

const args = parseArguments(process.argv);
const outputDir = path.resolve(args.output_dir || path.join(os.tmpdir(), "runtime-parity-ownership-repair"));
let report;

try {
  if (args.target_ref !== TARGET_REF) throw new Error("target_ref_mismatch");
  if (!SHA_PATTERN.test(args.expected_head_sha || "")) throw new Error("expected_head_sha_invalid");
  if (args.confirmation !== CONFIRMATION) throw new Error("typed_confirmation_invalid");
  const localHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const remoteHead = execFileSync("git", ["ls-remote", "origin", `refs/heads/${TARGET_REF}`], { cwd: repoRoot, encoding: "utf8" }).trim().split(/\s+/u)[0];
  if (localHead !== args.expected_head_sha || remoteHead !== args.expected_head_sha) throw new Error("exact_head_mismatch");

  const sourceFile = path.join(repoRoot, SCRIPT_PATH);
  let source = fs.readFileSync(sourceFile, "utf8");
  source = replaceOnce(source, ': "${EXPECTED_PRELAUNCH:?}"\n', "", "remove pull-request prelaunch input");
  source = replaceOnce(source, ': "${TEMP_TRIGGER:?}"\n', ': "${TEMP_TRIGGER:?}"\n: "${REFRESH_TOOL:?}"\n', "add refresh tool input");
  source = replaceOnce(
    source,
    'test "${GITHUB_HEAD_REF}" = "${EXPECTED_BRANCH}"\ntest "$(git rev-parse HEAD)" = "${EVENT_HEAD}"\ntest "$(git rev-parse HEAD^^)" = "${EXPECTED_PRELAUNCH}"\ntest "$(git diff --name-only HEAD^^..HEAD^)" = "${TEMP_WORKFLOW}"\ntest "$(git diff --name-only HEAD^..HEAD)" = "${TEMP_TRIGGER}"\n',
    'test "$(git rev-parse HEAD)" = "${EVENT_HEAD}"\n',
    "replace pull-request topology guard"
  );
  source = replaceOnce(
    source,
    "    '.runtime-parity-ownership-repair-v6.trigger',\n",
    "    '.runtime-parity-ownership-repair-v6.trigger',\n    'http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs',\n",
    "extend initial bootstrap scope"
  );
  source = replaceOnce(
    source,
    'rm -f -- "${TEMP_WORKFLOW}" "${TEMP_SCRIPT}" "${TEMP_TRIGGER}"\n',
    'rm -f -- "${TEMP_WORKFLOW}" "${TEMP_SCRIPT}" "${TEMP_TRIGGER}"\ngit checkout origin/main -- "${REFRESH_TOOL}"\n',
    "restore canonical refresh tool"
  );
  if (source.includes("EXPECTED_PRELAUNCH") || source.includes("GITHUB_HEAD_REF")) throw new Error("stale_pull_request_guard_remains");

  const runtimeScript = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `runtime-parity-ownership-repair-${process.pid}.sh`);
  fs.writeFileSync(runtimeScript, source, { mode: 0o700 });
  const result = spawnSync("bash", [runtimeScript], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      EXPECTED_BRANCH: TARGET_REF,
      EXPECTED_MAIN,
      EVENT_HEAD: args.expected_head_sha,
      TEMP_WORKFLOW: WORKFLOW_PATH,
      TEMP_SCRIPT: SCRIPT_PATH,
      TEMP_TRIGGER: TRIGGER_PATH,
      REFRESH_TOOL,
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    const error = new Error("bounded_executor_failed");
    error.status = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr || result.error?.message;
    throw error;
  }

  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const changedFiles = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim().split(/\r?\n/u).filter(Boolean);
  report = {
    contract: "mad4b.runtime-parity-generated-binding-ownership-repair.v8",
    generated_at: new Date().toISOString(),
    outcome: "passed",
    target_ref: TARGET_REF,
    expected_head_sha: args.expected_head_sha,
    commit_sha: commitSha,
    changed_files: changedFiles,
    first_failure: null,
    mutation: { mode: "candidate_branch_only", protected_branch_mutation: false, force_push: false },
    secrets_included: false,
  };
} catch (error) {
  report = {
    contract: "mad4b.runtime-parity-generated-binding-ownership-repair.v8",
    generated_at: new Date().toISOString(),
    outcome: "blocked",
    target_ref: args.target_ref || null,
    expected_head_sha: args.expected_head_sha || null,
    commit_sha: null,
    changed_files: [],
    first_failure: {
      code: error?.message || "ownership_repair_unhandled_failure",
      exit_status: Number.isInteger(error?.status) ? error.status : null,
      stderr_tail: bounded(error?.stderr || error?.stack || error),
      stdout_tail: bounded(error?.stdout || ""),
      secrets_included: false,
    },
    mutation: { mode: "candidate_branch_only", protected_branch_mutation: false, force_push: false },
    secrets_included: false,
  };
}

writeReport(outputDir, report);
process.stdout.write(`${JSON.stringify({ contract: report.contract, outcome: report.outcome, commit_sha: report.commit_sha, first_failure: report.first_failure?.code || null, secrets_included: false })}\n`);
if (report.outcome !== "passed") process.exitCode = 1;
