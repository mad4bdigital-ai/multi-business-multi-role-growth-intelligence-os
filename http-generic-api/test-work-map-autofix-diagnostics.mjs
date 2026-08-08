import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const API_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.join(API_ROOT, "..");
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

function workflow(name) {
  return readFileSync(path.join(REPOSITORY_ROOT, ".github", "workflows", name), "utf8");
}

function assertPostAllocationReportDirectory(source, directoryName) {
  assert.doesNotMatch(
    source,
    /^\s{6}REPORT_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/mu,
    `${directoryName}: runner.temp must not be evaluated in job-level env`,
  );
  assert.match(source, /Initialize bounded report directory after runner allocation/u);
  assert.match(source, new RegExp(`report_dir="\\$\\{RUNNER_TEMP\\}/${directoryName}"`, "u"));
  assert.match(source, /echo "REPORT_DIR=\$\{report_dir\}" >> "\$\{GITHUB_ENV\}"/u);
  assert.match(source, new RegExp(`path: \\$\\{\\{ runner\\.temp \\}\\}/${directoryName}/`, "u"));
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
  assert.equal(run(["init", "--root", uncapturedRoot]).status, 0);
  assert.equal(run(["finalize", "--root", uncapturedRoot, "--conclusion", "failure"]).status, 0);
  const uncapturedReport = JSON.parse(readFileSync(path.join(uncapturedRoot, "report.json"), "utf8"));
  assert.equal(uncapturedReport.status, "failed");
  assert.equal(uncapturedReport.uncapturedFailure, true);
  assert.equal(uncapturedReport.firstFailure, null);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const bootstrapWorkflow = workflow("spec-kit-work-map-recovery-bootstrap.yml");
const recoveryWorkflow = workflow("spec-kit-work-map-autofix-recovery-dispatch.yml");
const writerWorkflow = workflow("spec-kit-work-map-autofix.yml");

assert.match(bootstrapWorkflow, /^name: Spec Kit Work Map Recovery Bootstrap$/mu);
assert.match(bootstrapWorkflow, /issue_comment:\s*\n\s*types: \[created\]/u);
assert.match(bootstrapWorkflow, /workflow_dispatch:/u);
assert.doesNotMatch(bootstrapWorkflow, /^\s*pull_request(?:_target)?:/mu);
assert.doesNotMatch(bootstrapWorkflow, /^\s*push:/mu);
assert.match(bootstrapWorkflow, /^\s{4}runs-on: ubuntu-24\.04-arm$/mu);
assert.match(
  bootstrapWorkflow,
  /permissions:\s*\n\s*actions: write\s*\n\s*contents: read\s*\n\s*issues: write\s*\n\s*pull-requests: read/u,
);
assert.doesNotMatch(bootstrapWorkflow, /contents: write/u);
assertPostAllocationReportDirectory(bootstrapWorkflow, "spec-kit-work-map-recovery-bootstrap");
assert.match(bootstrapWorkflow, /ACTIVATE_SPEC_KIT_WORK_MAP_RECOVERY/u);
assert.match(bootstrapWorkflow, /\/activate-work-map-recovery\[\[:space:\]\]\+\(\[0-9a-f\]\{40\}\)/u);
assert.match(bootstrapWorkflow, /jq -r '\.state'/u);
assert.match(bootstrapWorkflow, /jq -r '\.base\.ref'/u);
assert.match(bootstrapWorkflow, /jq -r '\.head\.repo\.full_name'/u);
assert.doesNotMatch(bootstrapWorkflow, /jq -r '\.draft'/u);
assert.match(bootstrapWorkflow, /test "\$\{current_head_sha\}" = "\$\{REQUESTED_HEAD_SHA\}"/u);
assert.match(bootstrapWorkflow, /grep -Fq "\$\{AUTHORIZATION_MARKER\}"/u);
assert.match(bootstrapWorkflow, /compare\/main\.\.\.\$\{REQUESTED_HEAD_SHA\}/u);
assert.match(bootstrapWorkflow, /test "\$\{behind_by\}" = "0"/u);
assert.match(bootstrapWorkflow, /actions\/workflows\/\$\{recovery_workflow\}\/enable/u);
assert.match(bootstrapWorkflow, /actions\/workflows\/\$\{recovery_workflow\}\/dispatches/u);
assert.match(bootstrapWorkflow, /expected_head_sha:\$expected_head_sha/u);
assert.match(bootstrapWorkflow, /RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX/u);
assert.match(bootstrapWorkflow, /WORK_MAP_RECOVERY_BOOTSTRAP/u);
assert.match(bootstrapWorkflow, /direct_repository_mutation:false/u);
assert.match(bootstrapWorkflow, /authorization_consumed:false/u);
assert.match(bootstrapWorkflow, /protected_branch_mutation:false/u);
assert.match(bootstrapWorkflow, /force_push:false/u);
assert.match(bootstrapWorkflow, /secrets_included:false/u);
assert.doesNotMatch(bootstrapWorkflow, /spec-kit-work-map-autofix\.yml\/dispatches/u);
assert.doesNotMatch(bootstrapWorkflow, /gh api --method PATCH/u);
assert.doesNotMatch(bootstrapWorkflow, /git (?:add|commit|push)/u);
assert.doesNotMatch(bootstrapWorkflow, /--force|force-with-lease/u);

assert.match(recoveryWorkflow, /^name: Spec Kit Work Map Autofix Recovery Dispatch$/mu);
assert.match(recoveryWorkflow, /on:\s*\n\s*workflow_dispatch:/u);
assert.doesNotMatch(recoveryWorkflow, /^\s*issue_comment:/mu);
assert.doesNotMatch(recoveryWorkflow, /^\s*pull_request(?:_target)?:/mu);
assert.doesNotMatch(recoveryWorkflow, /^\s*push:/mu);
assert.match(recoveryWorkflow, /expected_head_sha:\s*\n\s*description: Exact current pull-request head SHA authorized for recovery/u);
assert.match(recoveryWorkflow, /^\s{4}runs-on: ubuntu-24\.04-arm$/mu);
assert.match(
  recoveryWorkflow,
  /permissions:\s*\n\s*actions: write\s*\n\s*contents: read\s*\n\s*issues: write\s*\n\s*pull-requests: write/u,
);
assert.doesNotMatch(recoveryWorkflow, /contents: write/u);
assertPostAllocationReportDirectory(recoveryWorkflow, "spec-kit-work-map-autofix-recovery");
assert.match(recoveryWorkflow, /REQUESTED_HEAD_SHA: \$\{\{ inputs\.expected_head_sha \}\}/u);
assert.match(recoveryWorkflow, /RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX/u);
assert.match(recoveryWorkflow, /state="\$\(jq -r '\.state'/u);
assert.match(recoveryWorkflow, /base_ref="\$\(jq -r '\.base\.ref'/u);
assert.match(recoveryWorkflow, /head_repo="\$\(jq -r '\.head\.repo\.full_name'/u);
assert.doesNotMatch(recoveryWorkflow, /jq -r '\.draft'/u);
assert.match(recoveryWorkflow, /test "\$\{state\}" = "open"/u);
assert.match(recoveryWorkflow, /test "\$\{base_ref\}" = "main"/u);
assert.match(recoveryWorkflow, /test "\$\{head_repo\}" = "\$\{GITHUB_REPOSITORY\}"/u);
assert.match(recoveryWorkflow, /test "\$\{current_head_sha\}" = "\$\{REQUESTED_HEAD_SHA\}"/u);
assert.match(recoveryWorkflow, /grep -Fq "\$\{AUTHORIZATION_MARKER\}"/u);
assert.match(recoveryWorkflow, /compare\/main\.\.\.\$\{REQUESTED_HEAD_SHA\}/u);
assert.match(recoveryWorkflow, /test "\$\{behind_by\}" = "0"/u);
assert.match(recoveryWorkflow, /Consume one-time authorization marker/u);
assert.match(recoveryWorkflow, /gh api --method PATCH "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}"/u);
assert.match(recoveryWorkflow, /actions\/workflows\/spec-kit-work-map-autofix\.yml\/dispatches/u);
assert.match(recoveryWorkflow, /authorization_consumed:\$authorization_consumed/u);
assert.match(recoveryWorkflow, /direct_repository_mutation:false/u);
assert.match(recoveryWorkflow, /protected_branch_mutation:false/u);
assert.match(recoveryWorkflow, /force_push:false/u);
assert.match(recoveryWorkflow, /secrets_included:false/u);
assert.doesNotMatch(recoveryWorkflow, /git (?:add|commit|push)/u);
assert.doesNotMatch(recoveryWorkflow, /--force|force-with-lease/u);

assert.match(writerWorkflow, /^name: Spec Kit Work Map Autofix$/mu);
assert.match(writerWorkflow, /^\s{4}runs-on: windows-latest$/mu);
assert.match(writerWorkflow, /contents: write/u);
assert.match(writerWorkflow, /EXPECTED_HEAD_SHA/u);
assert.match(writerWorkflow, /remote_head_sha/u);
assert.match(writerWorkflow, /test "\$\{remote_head_sha\}" = "\$\{EXPECTED_HEAD_SHA\}"/u);
assert.match(writerWorkflow, /git push/u);

console.log("Work Map diagnostics, draft-safe explicit recovery isolation, and ARM runner boundaries passed");
