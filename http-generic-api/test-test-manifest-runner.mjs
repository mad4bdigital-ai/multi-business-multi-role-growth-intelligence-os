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
const generatedRefreshWorkflow = fs.readFileSync(
  new URL("../.github/workflows/pr-generated-artifact-refresh.yml", import.meta.url),
  "utf8",
);
const ciAutostartWorkflow = fs.readFileSync(
  new URL("../.github/workflows/ci-autostart-recovery.yml", import.meta.url),
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
  "node test-agent-capability-admin-tool-registry.mjs",
  "node test-agent-capability-coverage.mjs",
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
  "node test-governed-migration-dependency-gate.mjs",
  "node test-platform-engine-orchestration.mjs",
  "node test-sprint69-1006-governed-rollout-control.mjs",
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

for (const workflowSource of [generatedRefreshWorkflow, ciAutostartWorkflow]) {
  assert.ok(
    workflowSource.includes("github.event.pull_request.head.repo.full_name == github.repository"),
    "certification automation must stay restricted to same-repository pull requests",
  );
  assert.ok(
    workflowSource.includes("startsWith(github.event.pull_request.head.ref, 'gpt/')"),
    "existing governed gpt branch support must remain enabled",
  );
  assert.ok(
    workflowSource.includes("startsWith(github.event.pull_request.head.ref, 'cert/')"),
    "non-protected certification branch support must remain enabled",
  );
}
assert.ok(
  generatedRefreshWorkflow.includes("github.actor != 'github-actions[bot]'"),
  "generated refresh must prevent bot recursion",
);
assert.ok(
  generatedRefreshWorkflow.includes("contents: write"),
  "generated refresh requires bounded branch write permission",
);
assert.ok(
  ciAutostartWorkflow.includes("actions: write"),
  "CI recovery requires workflow dispatch permission",
);
assert.ok(
  ciAutostartWorkflow.includes("!github.event.pull_request.draft"),
  "CI recovery must not dispatch for draft pull requests",
);

console.log("test-manifest-runner checks passed");
