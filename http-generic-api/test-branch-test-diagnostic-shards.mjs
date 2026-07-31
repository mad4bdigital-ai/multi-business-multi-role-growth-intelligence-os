import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { testCommands } from "./scripts/run-test-manifest.mjs";

const API_ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "branch-test-diagnostic-"));

function run(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/run-test-diagnostic-shard.mjs", ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, ...env },
  });
}

try {
  assert.ok(Array.isArray(testCommands));
  assert.ok(testCommands.length > 100);
  assert.ok(testCommands.includes("node test-growth-control-typed-invalidation-consumer.mjs"));

  const reportFile = path.join(temporaryDirectory, "listed-shard.json");
  const result = run([
    "--parent-index", "1",
    "--parent-count", "2",
    "--shard-index", "2",
    "--shard-count", "4",
    "--grep", "growth-control",
    "--list",
    "--report-file", reportFile,
  ], {
    GITHUB_REPOSITORY: "example/repository",
    GITHUB_REF: "refs/pull/99/merge",
    GITHUB_HEAD_REF: "feature/example",
    GITHUB_BASE_REF: "main",
    GITHUB_SHA: "a".repeat(40),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(report.contract, "mad4b.test-diagnostic-shard-report.v1");
  assert.equal(report.status, "listed");
  assert.equal(report.repository, "example/repository");
  assert.equal(report.headRef, "feature/example");
  assert.equal(report.baseRef, "main");
  assert.equal(report.commitSha, "a".repeat(40));
  assert.equal(report.parentIndex, 1);
  assert.equal(report.parentCount, 2);
  assert.equal(report.shardIndex, 2);
  assert.equal(report.shardCount, 4);
  assert.equal(report.grep, "growth-control");
  assert.match(report.catalogSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.secretsIncluded, false);
  assert.equal(report.failures.length, 0);
  assert.equal(report.commands.every((item) => item.status === "listed"), true);
  assert.equal(report.commands.every((item) => item.command.includes("growth-control")), true);
  assert.equal(report.commands.every((item) => item.commandIndex % 2 === 1), true);

  const sameSelectionFile = path.join(temporaryDirectory, "same-selection.json");
  const sameSelection = run([
    "--parent-index=1",
    "--parent-count=2",
    "--shard-index=2",
    "--shard-count=4",
    "--grep=growth-control",
    "--list",
    `--report-file=${sameSelectionFile}`,
  ]);
  assert.equal(sameSelection.status, 0, sameSelection.stderr || sameSelection.stdout);
  const sameReport = JSON.parse(readFileSync(sameSelectionFile, "utf8"));
  assert.deepEqual(
    sameReport.commands.map((item) => [item.commandIndex, item.command]),
    report.commands.map((item) => [item.commandIndex, item.command]),
  );
  assert.equal(sameReport.catalogSha256, report.catalogSha256);

  const invalidCoordinates = run([
    "--parent-index", "2",
    "--parent-count", "2",
    "--shard-index", "0",
    "--shard-count", "4",
    "--list",
  ]);
  assert.equal(invalidCoordinates.status, 1);
  assert.match(invalidCoordinates.stderr, /coordinates are out of range/);

  const invalidPartitionCount = run([
    "--parent-index", "0",
    "--parent-count", "65",
    "--shard-index", "0",
    "--shard-count", "4",
    "--list",
  ]);
  assert.equal(invalidPartitionCount.status, 1);
  assert.match(invalidPartitionCount.stderr, /parentCount must be from 1 to 64/);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("branch-agnostic diagnostic shard automation tests passed");
