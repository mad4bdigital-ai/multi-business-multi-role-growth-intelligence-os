import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const API_ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "sequential-test-progress-"));

function run(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/run-test-manifest.mjs", ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, ...env },
  });
}

try {
  const passingReportFile = path.join(temporaryDirectory, "passing.json");
  const passing = run([
    "--grep", "test-branch-test-diagnostic-shards.mjs",
    "--report-file", passingReportFile,
  ], {
    GITHUB_REPOSITORY: "example/repository",
    GITHUB_REF: "refs/pull/99/merge",
    GITHUB_HEAD_REF: "feature/example",
    GITHUB_BASE_REF: "main",
    GITHUB_SHA: "b".repeat(40),
  });
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);

  const passingReport = JSON.parse(readFileSync(passingReportFile, "utf8"));
  assert.equal(passingReport.contract, "mad4b.test-manifest-progress-report.v1");
  assert.equal(passingReport.status, "passed");
  assert.equal(passingReport.repository, "example/repository");
  assert.equal(passingReport.headRef, "feature/example");
  assert.equal(passingReport.baseRef, "main");
  assert.equal(passingReport.commitSha, "b".repeat(40));
  assert.equal(passingReport.selectedCount, 1);
  assert.equal(passingReport.currentCommand, null);
  assert.equal(passingReport.firstFailure, null);
  assert.equal(passingReport.lastPassed.status, "passed");
  assert.match(passingReport.lastPassed.command, /test-branch-test-diagnostic-shards\.mjs/u);
  assert.equal(passingReport.commands.length, 1);
  assert.equal(passingReport.commands[0].status, "passed");
  assert.equal(Number.isInteger(passingReport.commands[0].commandIndex), true);
  assert.equal(passingReport.commands[0].durationMs >= 0, true);
  assert.match(passingReport.catalogSha256, /^[a-f0-9]{64}$/u);
  assert.equal(passingReport.secretsIncluded, false);

  const emptyReportFile = path.join(temporaryDirectory, "no-matches.json");
  const empty = run([
    "--grep=definitely-not-a-real-test-command",
    `--report-file=${emptyReportFile}`,
  ]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No test commands matched/u);

  const emptyReport = JSON.parse(readFileSync(emptyReportFile, "utf8"));
  assert.equal(emptyReport.contract, "mad4b.test-manifest-progress-report.v1");
  assert.equal(emptyReport.status, "no_matches");
  assert.equal(emptyReport.selectedCount, 0);
  assert.equal(emptyReport.commands.length, 0);
  assert.equal(emptyReport.currentCommand, null);
  assert.equal(emptyReport.lastPassed, null);
  assert.equal(emptyReport.firstFailure, null);
  assert.equal(emptyReport.secretsIncluded, false);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("sequential test progress report tests passed");
