import assert from "node:assert/strict";
import fs from "node:fs";

const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-scheduler-snapshot-runner.mjs", import.meta.url),
  "utf8"
);
const lifecycle = fs.readFileSync(new URL("./databaseTableLifecycle.js", import.meta.url), "utf8");
const jobRunner = fs.readFileSync(new URL("./jobRunner.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const docs = fs.readFileSync(
  new URL("../docs/database-lifecycle-reporting-views.md", import.meta.url),
  "utf8"
);
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

assert(runner.includes("runDatabaseLifecycleSchedulerSnapshot"));
assert(runner.includes("summary_only: false"));
assert(runner.includes("--summary-only"));
assert(lifecycle.includes("runDatabaseLifecycleSchedulerSnapshot"));
assert(lifecycle.includes("assessDatabaseLifecycleReportSnapshotScheduleReadiness"));
assert(lifecycle.includes("assessDatabaseLifecycleSchedulerBindingReadiness"));
assert(lifecycle.includes("verifyDatabaseLifecycleSchedulerApprovalReadback"));
assert(lifecycle.includes("assertDatabaseLifecycleReportSnapshotAllowed"));
assert(lifecycle.includes("writeDatabaseLifecycleReportSnapshot"));
assert(lifecycle.includes("buildSchedulerSnapshotBoundedOutput"));
assert(lifecycle.includes("snapshot_summary"));
assert(lifecycle.includes("schedule_readiness_summary"));
assert(lifecycle.includes("binding_readiness_summary"));
assert(lifecycle.includes("approval_readback_summary"));
assert(lifecycle.includes("blocked_reasons"));
assert(lifecycle.includes("will_execute: false"));
assert(lifecycle.includes("no_drop: true"));
assert(lifecycle.includes("no_delete: true"));
assert(lifecycle.includes("no_archive_execution: true"));
assert(lifecycle.includes("no_compaction_execution: true"));
assert(lifecycle.includes("secrets_included: false"));
assert(jobRunner.includes("DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_JOB_TYPE"));
assert(jobRunner.includes("runDatabaseLifecycleSchedulerSnapshot"));
assert(routes.includes("/platform/engines/database-lifecycle/scheduler-snapshot-runner"));
assert(routes.includes("/platform/engines/database-lifecycle/scheduler-snapshot-jobs"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-snapshot-runner:"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-snapshot-jobs:"));
assert(openapi.includes("operationId: databaseLifecycleSchedulerSnapshotJobEnqueue"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));
assert(!runner.includes("TRUNCATE TABLE"));
assert(!runner.includes("ALTER TABLE"));
assert(!lifecycle.includes("DROP TABLE"));
assert(!lifecycle.includes("TRUNCATE TABLE"));

assert(docs.includes("Scheduler snapshot runner"));
assert(docs.includes("database-lifecycle-scheduler-snapshot-runner.mjs"));
assert(docs.includes("readback is verified"));
assert(docs.includes("does not enable cron"));
assert(docs.includes("--summary-only"));
assert(docs.includes("bounded live output"));

assert(
  manifest.includes("node test-database-lifecycle-scheduler-snapshot-runner.mjs"),
  "test manifest must include scheduler snapshot runner contract test"
);

console.log("database lifecycle scheduler snapshot runner tests passed");
