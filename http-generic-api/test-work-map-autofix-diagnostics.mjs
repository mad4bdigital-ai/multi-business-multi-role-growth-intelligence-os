import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const API_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(API_ROOT, "scripts", "work-map-autofix-diagnostics.mjs");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "work-map-autofix-diagnostics-"));
const reportRoot = path.join(temporaryDirectory, "report");
const environment = {
  ...process.env,
  GITHUB_REPOSITORY: "example/repository",
  GITHUB_WORKFLOW: "Spec Kit Work Map Autofix",
  GITHUB_RUN_ID: "42",
  GITHUB_RUN_ATTEMPT: "3",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_SHA: "a".repeat(40),
  TARGET_BRANCH: "feature/work-map-report",
  EXPECTED_HEAD_SHA: "b".repeat(40),
  RUNNER_OS: "Windows",
  RUNNER_NAME: "Hosted Agent",
};

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    shell: false,
    env: environment,
  });
}

try {
  const initialized = run(["init", "--root", reportRoot]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const passed = run([
    "exec",
    "--root", reportRoot,
    "--id", "passing-command",
    "--",
    process.execPath,
    "-e",
    "console.log('governed pass')",
  ]);
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);

  const failed = run([
    "exec",
    "--root", reportRoot,
    "--id", "failing-command",
    "--",
    process.execPath,
    "-e",
    "console.error('governed failure marker'); process.exit(7)",
  ]);
  assert.equal(failed.status, 7, failed.stderr || failed.stdout);

  const finalized = run(["finalize", "--root", reportRoot, "--conclusion", "failure"]);
  assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout);

  const report = JSON.parse(readFileSync(path.join(reportRoot, "report.json"), "utf8"));
  assert.equal(report.contract, "mad4b.work-map-autofix-diagnostic-report.v1");
  assert.equal(report.status, "failed");
  assert.equal(report.repository, "example/repository");
  assert.equal(report.workflow, "Spec Kit Work Map Autofix");
  assert.equal(report.runId, "42");
  assert.equal(report.runAttempt, "3");
  assert.equal(report.targetBranch, "feature/work-map-report");
  assert.equal(report.expectedHeadSha, "b".repeat(40));
  assert.equal(report.commands.length, 2);
  assert.equal(report.lastPassed.id, "passing-command");
  assert.equal(report.lastPassed.status, "passed");
  assert.equal(report.firstFailure.id, "failing-command");
  assert.equal(report.firstFailure.exitCode, 7);
  assert.match(report.firstFailure.outputTail, /governed failure marker/u);
  assert.equal(report.currentCommand, null);
  assert.equal(report.uncapturedFailure, false);
  assert.equal(report.secretsIncluded, false);
  assert.equal(existsSync(path.join(reportRoot, report.firstFailure.logFile)), true);

  const markdown = readFileSync(path.join(reportRoot, "report.md"), "utf8");
  assert.match(markdown, /Work Map Autofix Diagnostic Report/u);
  assert.match(markdown, /failing-command/u);
  assert.match(markdown, /governed failure marker/u);
  assert.match(markdown, /does not enumerate environment values/u);

  const uncapturedRoot = path.join(temporaryDirectory, "uncaptured");
  const uncapturedInit = run(["init", "--root", uncapturedRoot]);
  assert.equal(uncapturedInit.status, 0, uncapturedInit.stderr || uncapturedInit.stdout);
  const uncapturedFinalize = run(["finalize", "--root", uncapturedRoot, "--conclusion", "failure"]);
  assert.equal(uncapturedFinalize.status, 0, uncapturedFinalize.stderr || uncapturedFinalize.stdout);
  const uncapturedReport = JSON.parse(readFileSync(path.join(uncapturedRoot, "report.json"), "utf8"));
  assert.equal(uncapturedReport.status, "failed");
  assert.equal(uncapturedReport.uncapturedFailure, true);
  assert.equal(uncapturedReport.firstFailure, null);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Work Map Autofix diagnostic report tests passed");
