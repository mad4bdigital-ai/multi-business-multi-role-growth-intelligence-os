import assert from "node:assert/strict";
import fs from "node:fs";

const completion = JSON.parse(
  fs.readFileSync(
    new URL("../specs/006-adaptive-authorization-execution-governance/completion.json", import.meta.url),
    "utf8",
  ),
);
const remainingLoop = fs.readFileSync(
  new URL("../specs/006-adaptive-authorization-execution-governance/remaining-task-loop-2026-07-07.md", import.meta.url),
  "utf8",
);
const tasks = fs.readFileSync(
  new URL("../specs/006-adaptive-authorization-execution-governance/tasks.md", import.meta.url),
  "utf8",
);

assert(tasks.includes("- [x] T030 Implement adapter bindings"));
assert(remainingLoop.includes("Completed through T030"));
assert(remainingLoop.includes("PR #2389 merged T030"));
assert.equal(completion.evidence.execution_governance.latest_task, "T030");
assert(completion.evidence.execution_governance.completed_tasks.includes("T030"));
assert.equal(completion.evidence.implementation.remaining_task_count, 11);
assert.deepEqual(completion.evidence.implementation.remaining_tasks, [
  "T040",
  "T041",
  "T042",
  "T043",
  "T050",
  "T051",
  "T052",
  "T053",
  "T061",
  "T062",
  "D010",
]);
assert.equal(completion.evidence.implementation.provider_mutation_allowed, false);
assert.equal(completion.evidence.implementation.enforcement_change_allowed, false);
assert.equal(completion.evidence.execution_governance.migration_execution_authorized, false);
assert.equal(completion.sensitive_values_included, false);

console.log("T030 ledger closeout assertions passed");
