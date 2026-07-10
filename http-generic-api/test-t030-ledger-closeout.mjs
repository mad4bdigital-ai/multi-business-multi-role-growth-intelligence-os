import assert from "node:assert/strict";
import fs from "node:fs";

// Ledger closeout assertions intentionally track the latest completed task.
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
assert(tasks.includes("- [x] T040 Run the three pilots in shadow mode without provider mutation."));
assert(tasks.includes("- [x] T041 Classify all legacy/adaptive mismatches."));
assert(remainingLoop.includes("Completed through T041"));
assert(remainingLoop.includes("PR #2460 merged T041"));
assert.equal(completion.evidence.execution_governance.latest_task, "T041");
assert(completion.evidence.execution_governance.completed_tasks.includes("T041"));
assert.equal(completion.evidence.implementation.remaining_task_count, 9);
assert.deepEqual(completion.evidence.implementation.remaining_tasks, [
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
assert.equal(completion.evidence.implementation.external_write_allowed, false);
assert.equal(completion.evidence.implementation.enforcement_change_allowed, false);
assert.equal(completion.evidence.execution_governance.migration_execution_authorized, false);
assert.equal(completion.sensitive_values_included, false);

console.log("T041 ledger closeout assertions passed");
