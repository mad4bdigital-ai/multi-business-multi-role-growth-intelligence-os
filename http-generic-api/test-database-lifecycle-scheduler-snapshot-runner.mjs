import assert from "node:assert/strict";
import fs from "node:fs";

const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-scheduler-snapshot-runner.mjs", import.meta.url),
  "utf8"
);
const docs = fs.readFileSync(
  new URL("../docs/database-lifecycle-reporting-views.md", import.meta.url),
  "utf8"
);
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

assert(runner.includes("assessDatabaseLifecycleReportSnapshotScheduleReadiness"));
assert(runner.includes("assessDatabaseLifecycleSchedulerBindingReadiness"));
assert(runner.includes("verifyDatabaseLifecycleSchedulerApprovalReadback"));
assert(runner.includes("assertDatabaseLifecycleReportSnapshotAllowed"));
assert(runner.includes("writeDatabaseLifecycleReportSnapshot"));
assert(runner.includes("blocked_reasons"));
assert(runner.includes("will_execute: false"));
assert(runner.includes("no_drop: true"));
assert(runner.includes("no_delete: true"));
assert(runner.includes("no_archive_execution: true"));
assert(runner.includes("no_compaction_execution: true"));
assert(runner.includes("secrets_included: false"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));
assert(!runner.includes("TRUNCATE TABLE"));
assert(!runner.includes("ALTER TABLE"));

assert(docs.includes("Scheduler snapshot runner"));
assert(docs.includes("database-lifecycle-scheduler-snapshot-runner.mjs"));
assert(docs.includes("readback is verified"));
assert(docs.includes("does not enable cron"));

assert(
  manifest.includes("node test-database-lifecycle-scheduler-snapshot-runner.mjs"),
  "test manifest must include scheduler snapshot runner contract test"
);

console.log("database lifecycle scheduler snapshot runner tests passed");
