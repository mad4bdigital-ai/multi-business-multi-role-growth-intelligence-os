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

assert(tasks.includes("- [x] T043 Add compatibility wrappers and measured deprecation metadata."));
assert(remainingLoop.includes("Completed through T043"));
assert(remainingLoop.includes("PR #2531 merged T043"));
assert.equal(completion.evidence.execution_governance.latest_task, "T043");
assert(completion.evidence.execution_governance.completed_tasks.includes("T043"));
assert.equal(completion.evidence.implementation.remaining_task_count, 7);
assert.deepEqual(completion.evidence.implementation.remaining_tasks, [
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
assert.equal(completion.evidence.execution_governance.route_removal_allowed, false);
assert.equal(completion.evidence.implementation.route_removal_allowed, false);
assert.equal(completion.sensitive_values_included, false);

console.log("T043 ledger closeout assertions passed");
