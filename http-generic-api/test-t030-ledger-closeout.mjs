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

assert(tasks.includes("- [x] T042 Approve parity thresholds before canary enforcement."));
assert(remainingLoop.includes("Completed through T042"));
assert(remainingLoop.includes("PR #2513 merged T042"));
assert.equal(completion.evidence.execution_governance.latest_task, "T042");
assert(completion.evidence.execution_governance.completed_tasks.includes("T042"));
assert.equal(completion.evidence.implementation.remaining_task_count, 8);
assert.deepEqual(completion.evidence.implementation.remaining_tasks, [
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
assert.equal(completion.evidence.execution_governance.canary_activation_allowed, false);
assert.equal(completion.evidence.implementation.canary_activation_allowed, false);
assert.equal(completion.sensitive_values_included, false);

console.log("T042 ledger closeout assertions passed");
