import assert from "node:assert/strict";
import fs from "node:fs";
import "./scripts/test-operation-orchestrator.mjs";
import "./test-durable-execution-control-service.mjs";
import { testCommands } from "./scripts/test-manifest.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const runnerSource = fs.readFileSync(new URL("./scripts/run-test-manifest.mjs", import.meta.url), "utf8");
const suiteSource = fs.readFileSync(
  new URL("./scripts/run-test-and-run-adaptive-authorization-verification-manifest.mjs", import.meta.url),
  "utf8",
);

assert.equal(
  packageJson.scripts.test,
  "node scripts/run-test-and-run-adaptive-authorization-verification-manifest.mjs",
);
assert.equal(packageJson.scripts["test:list"], "node scripts/run-test-manifest.mjs --list");
assert.ok(!packageJson.scripts.test.includes("&&"), "package test script must not be a shell chain");

const duplicateCommands = testCommands.filter((command, index) => testCommands.indexOf(command) !== index);
assert.deepEqual(duplicateCommands, [], "test manifest must not contain duplicate commands");

for (const requiredCommand of [
  "node test-cms-authority-reconciliation.mjs",
  "node test-database-table-lifecycle-registry-upsert.mjs",
  "node test-database-lifecycle-retention-plan.mjs",
  "node test-database-lifecycle-report-snapshot.mjs",
  "node test-database-lifecycle-report-schedule-readiness.mjs",
  "node test-database-lifecycle-scheduler-binding-readiness.mjs",
  "node test-database-lifecycle-scheduler-approval-metadata.mjs",
  "node test-database-lifecycle-scheduler-admin-aliases.mjs",
  "node test-database-lifecycle-scheduler-snapshot-runner.mjs",
  "node test-dynamic-capability-audit-foundation.mjs",
  "node test-platform-engine-orchestration.mjs",
  "node test-test-manifest-runner.mjs",
  "node test-platform-engine-validator-runner.mjs",
  "node test-canonical-execution-intent-isolation.mjs",
  "node test-execution-intent-binding-migration-contract.mjs",
]) {
  assert.ok(testCommands.includes(requiredCommand), `missing manifest command: ${requiredCommand}`);
}

assert.match(runnerSource, /spawnSync/);
assert.match(runnerSource, /stdio:\s*"inherit"/);
assert.match(runnerSource, /shell:\s*false/);

assert.match(suiteSource, /spawnSync/);
assert.match(suiteSource, /scripts\/run-test-manifest\.mjs/);
assert.match(suiteSource, /scripts\/run-adaptive-authorization-verification-manifest\.mjs/);
assert.match(suiteSource, /stdio:\s*"inherit"/);
assert.match(suiteSource, /shell:\s*false/);

console.log("test-manifest-runner checks passed");
