import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const closeout = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2h-policy-post-merge-and-t026-readiness.json",
));

assert.equal(closeout.status, "complete_on_main");
assert.equal(closeout.merge_is_main_ancestor, true);

for (const taskId of closeout.completed_tasks) {
  const completedPattern = new RegExp(`^- \\[x\\] \\*\\*${taskId}\\*\\*`, "mu");
  assert.match(
    tasks,
    completedPattern,
    `${taskId} must remain checked in the Spec 012 task ledger`,
  );
}

assert.match(tasks, /^- \[ \] \*\*T026\*\*/mu);
assert.match(tasks, /PR #5049/u);
assert.match(tasks, /no checksum-bound authorization/u);
assert.match(tasks, /migration-ledger readback/u);
assert.match(tasks, /schema readback/u);

assert.equal(closeout.t026.status, "readiness_required");
assert.equal(closeout.t026.authorization_registered, false);
assert.equal(closeout.t026.apply_authorized, false);
assert.equal(closeout.t026.migration_applied, false);
assert.equal(closeout.t026.ledger_readback_complete, false);
assert.equal(closeout.t026.schema_readback_complete, false);

console.log("Spec 012 task ledger reconciliation tests passed");
