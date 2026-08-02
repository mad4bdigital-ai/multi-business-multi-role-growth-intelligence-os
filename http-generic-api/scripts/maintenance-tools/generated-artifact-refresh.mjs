#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT = "mad4b.governed-generated-artifact-refresh.v1";
const CONFIRMATION = "APPLY_GENERATED_ARTIFACT_REFRESH";
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TARGET_BRANCH_PATTERN = /^(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;
const PROTECTED_BRANCHES = new Set(["main", "Production"]);
const MAX_DIAGNOSTIC_CHARS = 4000;
const ALLOWED_CHANGED_FILES = new Set([
  "http-generic-api/openapi.yaml",
  "http-generic-api/openapi/support-tickets.yaml",
  "http-generic-api/frontend-operation-governance.generated.json",
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.activation-admin.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.auth.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.activation.yaml",
  "http-generic-api/openapi.gpt-action.local-connector.yaml",
]);

const scriptPath = fileURLToPath(import.meta.url);
const apiDir = path.resolve(path.dirname(scriptPath), "../..");
const repoRoot = path.resolve(apiDir, "..");

function parseArguments(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function sanitize(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "[redacted-github-token]")
    .slice(-MAX_DIAGNOSTIC_CHARS);
}

class ToolFailure extends Error {
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
    throw new ToolFailure({
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

function validateInputs({ target_ref, expected_head_sha, confirmation }) {
  if (!target_ref || !TARGET_BRANCH_PATTERN.test(target_ref)) {
    throw new ToolFailure({ code: "target_ref_invalid", step: "validate_inputs", command: "validate target_ref", status: 1, stderr: "Target ref must match a governed work-branch pattern." });
  }
  const target_branch = target_ref;
  if (PROTECTED_BRANCHES.has(target_branch) || target_branch === "main" || target_branch === "Production") {
    throw new ToolFailure({ code: "protected_branch_mutation_forbidden", step: "validate_inputs", command: "reject protected branch", status: 1, stderr: "main and Production are forbidden mutation targets." });
  }
  if (!FULL_SHA_PATTERN.test(expected_head_sha || "")) {
    throw new ToolFailure({ code: "expected_head_sha_invalid", step: "validate_inputs", command: "validate expected_head_sha", status: 1, stderr: "An exact 40-character expected_head_sha is required." });
  }
  if (confirmation !== CONFIRMATION) {
    throw new ToolFailure({ code: "typed_confirmation_required", step: "validate_inputs", command: "validate confirmation", status: 1, stderr: `Confirmation must equal ${CONFIRMATION}.` });
  }
}

function readRemoteHead(target_ref) {
  const result = run("read_remote_head", "git", ["ls-remote", "origin", `refs/heads/${target_ref}`], { cwd: repoRoot });
  return String(result.stdout || "").trim().split(/\s+/u)[0] || null;
}

function assertExpectedHead({ target_ref, expected_head_sha, phase }) {
  const current_head_sha = readRemoteHead(target_ref);
  if (current_head_sha !== expected_head_sha) {
    throw new ToolFailure({
      code: "expected_head_sha_mismatch",
      step: phase,
      command: `git ls-remote origin refs/heads/${target_ref}`,
      status: 1,
      stdout: `expected_head_sha=${expected_head_sha} current_head_sha=${current_head_sha || "missing"}`,
      stderr: "The target branch moved; refusing repository mutation.",
    });
  }
  const local_head_sha = run("read_local_head", "git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
  if (local_head_sha !== expected_head_sha) {
    throw new ToolFailure({
      code: "local_expected_head_sha_mismatch",
      step: phase,
      command: "git rev-parse HEAD",
      status: 1,
      stdout: `expected_head_sha=${expected_head_sha} local_head_sha=${local_head_sha}`,
      stderr: "The checked-out candidate does not equal expected_head_sha.",
    });
  }
}

function parseChangedFiles() {
  const result = run("inspect_write_set", "git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot });
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
}

function buildFailure(error) {
  const failure = error instanceof ToolFailure
    ? error
    : new ToolFailure({ code: "generated_artifact_refresh_unhandled_failure", step: "unhandled", command: "unknown", status: null, stderr: error?.stack || error?.message || String(error) });
  return {
    code: failure.code,
    step: failure.step,
    command: failure.command,
    exit_status: Number.isInteger(failure.status) ? failure.status : null,
    stderr_tail: failure.stderr || "",
    stdout_tail: failure.stdout || "",
    secrets_included: false,
  };
}

function writeReport(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "generated-artifact-refresh-report.json");
  const markdownPath = path.join(outputDir, "generated-artifact-refresh-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Governed Generated Artifact Refresh",
    "",
    `- Contract: \`${report.contract}\``,
    `- Outcome: **${report.outcome}**`,
    `- Target ref: \`${report.target_ref}\``,
    `- Expected head SHA: \`${report.expected_head_sha}\``,
    `- Resulting commit SHA: \`${report.commit_sha || "none"}\``,
    `- Changed files: **${report.changed_files.length}**`,
    "- Force push: **no**",
    "- Protected branch mutation: **no**",
    "- Job logs: **diagnostic-only**",
  ];
  if (report.first_failure) {
    lines.push(
      "",
      "## First blocking finding",
      "",
      `- Code: \`${report.first_failure.code}\``,
      `- Step: \`${report.first_failure.step}\``,
      `- Bounded stderr: \`${String(report.first_failure.stderr_tail || "").replace(/`/gu, "'")}\``,
      `- Bounded stdout: \`${String(report.first_failure.stdout_tail || "").replace(/`/gu, "'")}\``,
    );
  }
  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  return { jsonPath, markdownPath };
}

export function runGovernedGeneratedArtifactRefresh(argv = process.argv) {
  const args = parseArguments(argv);
  const outputDir = path.resolve(args.output_dir || path.join(process.env.RUNNER_TEMP || repoRoot, "governed-generated-artifact-refresh"));
  let changedFiles = [];
  let commitSha = null;
  let firstFailure = null;

  try {
    validateInputs(args);
    assertExpectedHead({ target_ref: args.target_ref, expected_head_sha: args.expected_head_sha, phase: "preflight_expected_head" });
    run("install_dependencies", "npm", ["ci"], { cwd: apiDir, failureCode: "npm_ci_failed" });
    run("fetch_main", "git", ["fetch", "origin", "main", "--depth=1"], { cwd: repoRoot });
    run("sync_main_ref", "git", ["branch", "-f", "main", "origin/main"], { cwd: repoRoot });
    run("verify_exact_operation_auth_repair", "node", ["scripts/test-openapi-runtime-auth-sync-operation-insertion.mjs"], { cwd: apiDir });
    run("sync_precise_registry", "node", ["scripts/openapi-precise-contract-registry-sync.mjs", "--write"], { cwd: apiDir });
    run("autofill_openapi_routes", "node", ["scripts/openapi-autofill-missing-routes.mjs", "--write"], { cwd: apiDir });
    run("sync_openapi_runtime_auth", "node", ["scripts/openapi-runtime-auth-sync.mjs", "--write"], { cwd: apiDir });
    run("generate_frontend_dispatch", "npm", ["run", "frontend:dispatch:generate", "--", "--baseline-ref=main"], { cwd: apiDir });
    run("generate_custom_gpt_schemas", "node", ["scripts/generate-custom-gpt-schemas.mjs", "--write"], { cwd: apiDir });

    const verificationCommands = [
      ["verify_openapi_autofill", "node", ["test-openapi-autofill-missing-routes.mjs"]],
      ["verify_openapi_auth_operation_insertion", "node", ["scripts/test-openapi-runtime-auth-sync-operation-insertion.mjs"]],
      ["verify_frontend_governance", "node", ["test-frontend-operation-governance-generator.mjs"]],
      ["verify_frontend_dispatch", "node", ["test-frontend-surface-dispatch.mjs"]],
      ["verify_auth_parity", "node", ["test-frontend-auth-openapi-parity.mjs"]],
      ["verify_openapi_route_coverage", "node", ["test-openapi-route-coverage.mjs"]],
      ["verify_openapi_auth", "npm", ["run", "openapi:auth:check"]],
      ["verify_schema_guard", "npm", ["run", "schemas:guard"]],
    ];
    for (const [step, command, commandArgs] of verificationCommands) run(step, command, commandArgs, { cwd: apiDir });

    changedFiles = parseChangedFiles();
    const unexpected = changedFiles.filter((file) => !ALLOWED_CHANGED_FILES.has(file));
    if (unexpected.length) {
      throw new ToolFailure({ code: "generated_artifact_write_set_violation", step: "enforce_write_set", command: "validate generated artifact paths", status: 1, stdout: unexpected.join("\n"), stderr: "Generated files exceeded the registered allowlist." });
    }

    if (changedFiles.length) {
      assertExpectedHead({ target_ref: args.target_ref, expected_head_sha: args.expected_head_sha, phase: "precommit_expected_head" });
      run("configure_git_name", "git", ["config", "user.name", "github-actions[bot]"], { cwd: repoRoot });
      run("configure_git_email", "git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd: repoRoot });
      run("stage_generated_artifacts", "git", ["add", "--", ...changedFiles], { cwd: repoRoot });
      run("commit_generated_artifacts", "git", ["commit", "-m", "chore(ci): refresh generated contract artifacts"], { cwd: repoRoot });
      commitSha = run("read_resulting_commit", "git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
      if (!FULL_SHA_PATTERN.test(commitSha)) throw new ToolFailure({ code: "resulting_commit_sha_invalid", step: "read_resulting_commit", command: "git rev-parse HEAD", status: 1, stdout: commitSha });
      const current_head_sha = readRemoteHead(args.target_ref);
      if (current_head_sha !== args.expected_head_sha) {
        throw new ToolFailure({ code: "expected_head_sha_mismatch_before_push", step: "prepush_expected_head", command: "git ls-remote", status: 1, stdout: `expected_head_sha=${args.expected_head_sha} current_head_sha=${current_head_sha || "missing"}`, stderr: "The target branch moved before push; refusing repository mutation." });
      }
      run("push_generated_artifacts", "git", ["push", "origin", `HEAD:${args.target_ref}`], { cwd: repoRoot });
    }
  } catch (error) {
    firstFailure = buildFailure(error);
  }

  const report = {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    outcome: firstFailure ? "blocked" : "passed",
    target_ref: args.target_ref || null,
    expected_head_sha: args.expected_head_sha || null,
    commit_sha: commitSha,
    changed_files: changedFiles,
    first_failure: firstFailure,
    mutation: {
      mode: "mutating",
      expected_head_verified: !firstFailure || !String(firstFailure.code).includes("expected_head"),
      protected_branches_rejected: true,
      force_push: false,
      allowed_changed_paths_only: !firstFailure || firstFailure.code !== "generated_artifact_write_set_violation",
    },
    routing: {
      source_of_truth: "canonical_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: false,
    },
    secrets_included: false,
  };
  writeReport(outputDir, report);
  process.stdout.write(`${JSON.stringify({ contract: report.contract, outcome: report.outcome, commit_sha: report.commit_sha, first_failure: report.first_failure?.code || null, secrets_included: false })}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = runGovernedGeneratedArtifactRefresh();
  if (report.outcome !== "passed") process.exitCode = 1;
}
