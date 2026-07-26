import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assessDatabaseLifecycleReportSnapshotScheduleReadiness,
  buildDatabaseLifecycleReportSnapshotScheduleReadiness,
  listDatabaseLifecycleReportSnapshotSchedules,
} from "./databaseTableLifecycle.js";

const migration = fs.readFileSync(
  new URL("./migrations/183_sprint66_database_lifecycle_snapshot_schedule_readiness.sql", import.meta.url),
  "utf8"
);
const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-report-schedule-readiness.mjs", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshot_schedules"));
assert(migration.includes("v_database_lifecycle_report_snapshot_schedule_readiness"));
assert(migration.includes("database_lifecycle_report_snapshot_schedules"));
assert(migration.includes("database_lifecycle_report_snapshot_schedule_readiness"));
assert(migration.includes("'planned_disabled'"));
assert(migration.includes("'pending'"));
for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+database_table_lifecycle_registry\b/i]) {
  assert(!forbidden.test(migration), `schedule readiness migration must not include destructive operation: ${forbidden}`);
}

const readiness = buildDatabaseLifecycleReportSnapshotScheduleReadiness([
  {
    schedule_key: "database_lifecycle_retention_plan_weekly",
    report_type: "retention_plan",
    cron_expression: "0 3 * * 1",
    status: "planned_disabled",
    approval_status: "pending",
    executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
  },
  {
    schedule_key: "database_lifecycle_retention_plan_weekly_active",
    report_type: "retention_plan",
    cron_expression: "0 3 * * 1",
    notification_target: "admin_ops",
    status: "active",
    approval_status: "approved",
    executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
  },
]);
assert.equal(readiness.ok, true);
assert.equal(readiness.readiness_type, "database_lifecycle_report_snapshot_schedule_readiness_v1");
assert.equal(readiness.schedule_count, 2);
assert.equal(readiness.ready_count, 1);
assert.equal(readiness.blocked_count, 1);
assert.equal(readiness.dry_run, true);
assert.equal(readiness.will_execute, false);
assert.equal(readiness.no_drop, true);
assert.equal(readiness.no_delete, true);
assert.equal(readiness.no_archive_execution, true);
assert.equal(readiness.no_compaction_execution, true);
assert.equal(readiness.secrets_included, false);
assert(readiness.schedules[0].readiness_blockers.includes("schedule_not_active"));
assert(readiness.schedules[0].readiness_blockers.includes("approval_not_approved"));
assert(readiness.schedules[0].readiness_blockers.includes("notification_target_missing"));

let captured = [];
const fakePool = {
  async query(sql, params) {
    captured.push({ sql, params });
    if (sql.includes("FROM database_lifecycle_report_snapshot_schedules")) {
      return [[{
        schedule_key: "database_lifecycle_retention_plan_weekly",
        report_type: "retention_plan",
        cron_expression: "0 3 * * 1",
        status: "planned_disabled",
        approval_status: "pending",
      }]];
    }
    return [[]];
  },
};
const schedules = await listDatabaseLifecycleReportSnapshotSchedules({ report_type: "retention_plan", status: "planned_disabled" }, { pool: fakePool });
assert.equal(schedules.length, 1);
assert(captured[0].sql.includes("WHERE report_type = ? AND status = ?"));
assert.deepEqual(captured[0].params, ["retention_plan", "planned_disabled", 50]);

captured = [];
const assessed = await assessDatabaseLifecycleReportSnapshotScheduleReadiness({ schedule_key: "database_lifecycle_retention_plan_weekly" }, { pool: fakePool });
assert.equal(assessed.schedule_count, 1);
assert.equal(assessed.ready_count, 0);
assert(captured[0].sql.includes("WHERE schedule_key = ?"));

assert(runner.includes("assessDatabaseLifecycleReportSnapshotScheduleReadiness"));
assert(!runner.includes("--apply"));
assert(!runner.includes("writeDatabaseLifecycleReportSnapshot"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));

assert(routesSource.includes("/platform/engines/database-lifecycle/report-snapshot-schedules"));
assert(routesSource.includes("/platform/engines/database-lifecycle/report-snapshot-schedule-readiness"));
assert(openapi.includes("/platform/engines/database-lifecycle/report-snapshot-schedules:"));
assert(openapi.includes("/platform/engines/database-lifecycle/report-snapshot-schedule-readiness:"));
assert(openapi.includes("databaseLifecycleReportSnapshotSchedules"));
assert(openapi.includes("databaseLifecycleReportSnapshotScheduleReadiness"));

console.log("database lifecycle report schedule readiness tests passed");
