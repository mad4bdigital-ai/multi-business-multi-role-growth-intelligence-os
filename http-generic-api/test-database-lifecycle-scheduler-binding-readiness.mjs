import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assessDatabaseLifecycleSchedulerBindingReadiness,
  buildDatabaseLifecycleSchedulerBindingReadiness,
  listDatabaseLifecycleSchedulerBindings,
} from "./databaseTableLifecycle.js";

const migration = fs.readFileSync(
  new URL("./migrations/184_sprint66_database_lifecycle_scheduler_binding_readiness.sql", import.meta.url),
  "utf8"
);
const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-scheduler-binding-readiness.mjs", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshot_scheduler_bindings"));
assert(migration.includes("v_database_lifecycle_scheduler_binding_readiness"));
assert(migration.includes("database_lifecycle_scheduler_bindings"));
assert(migration.includes("database_lifecycle_scheduler_binding_readiness"));
assert(migration.includes("'planned_disabled'"));
assert(migration.includes("'pending'"));
for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+database_table_lifecycle_registry\b/i]) {
  assert(!forbidden.test(migration), `scheduler binding migration must not include destructive operation: ${forbidden}`);
}

const readiness = buildDatabaseLifecycleSchedulerBindingReadiness([
  {
    binding_key: "database_lifecycle_retention_plan_weekly_binding",
    schedule_key: "database_lifecycle_retention_plan_weekly",
    runner_command: "node scripts/database-lifecycle-report-snapshot.mjs --apply --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT",
    executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
    status: "planned_disabled",
    approval_status: "pending",
    schedule_status: "planned_disabled",
    schedule_approval_status: "pending",
    confirmation_required: 1,
    readback_required: 1,
    will_execute: 0,
  },
  {
    binding_key: "database_lifecycle_retention_plan_weekly_binding_active",
    schedule_key: "database_lifecycle_retention_plan_weekly",
    runner_command: "node scripts/database-lifecycle-report-snapshot.mjs --apply --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT",
    executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
    notification_target: "admin_ops",
    status: "active",
    approval_status: "approved",
    schedule_status: "active",
    schedule_approval_status: "approved",
    confirmation_required: 1,
    readback_required: 1,
    will_execute: 0,
  },
]);
assert.equal(readiness.ok, true);
assert.equal(readiness.readiness_type, "database_lifecycle_scheduler_binding_readiness_v1");
assert.equal(readiness.binding_count, 2);
assert.equal(readiness.ready_count, 1);
assert.equal(readiness.blocked_count, 1);
assert.equal(readiness.dry_run, true);
assert.equal(readiness.will_execute, false);
assert.equal(readiness.no_drop, true);
assert.equal(readiness.no_delete, true);
assert.equal(readiness.no_archive_execution, true);
assert.equal(readiness.no_compaction_execution, true);
assert.equal(readiness.secrets_included, false);
assert(readiness.bindings[0].readiness_blockers.includes("binding_not_active"));
assert(readiness.bindings[0].readiness_blockers.includes("binding_approval_not_approved"));
assert(readiness.bindings[0].readiness_blockers.includes("schedule_not_active"));
assert(readiness.bindings[0].readiness_blockers.includes("notification_target_missing"));

let captured = [];
const fakePool = {
  async query(sql, params) {
    captured.push({ sql, params });
    if (sql.includes("FROM database_lifecycle_report_snapshot_scheduler_bindings")) {
      return [[{
        binding_key: "database_lifecycle_retention_plan_weekly_binding",
        schedule_key: "database_lifecycle_retention_plan_weekly",
        runner_command: "node scripts/database-lifecycle-report-snapshot.mjs --apply --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT",
        status: "planned_disabled",
        approval_status: "pending",
        schedule_status: "planned_disabled",
        schedule_approval_status: "pending",
      }]];
    }
    return [[]];
  },
};
const bindings = await listDatabaseLifecycleSchedulerBindings({ schedule_key: "database_lifecycle_retention_plan_weekly", status: "planned_disabled" }, { pool: fakePool });
assert.equal(bindings.length, 1);
assert(captured[0].sql.includes("WHERE b.schedule_key = ? AND b.status = ?"));
assert.deepEqual(captured[0].params, ["database_lifecycle_retention_plan_weekly", "planned_disabled", 50]);

captured = [];
const assessed = await assessDatabaseLifecycleSchedulerBindingReadiness({ binding_key: "database_lifecycle_retention_plan_weekly_binding" }, { pool: fakePool });
assert.equal(assessed.binding_count, 1);
assert.equal(assessed.ready_count, 0);
assert(captured[0].sql.includes("WHERE b.binding_key = ?"));

assert(runner.includes("assessDatabaseLifecycleSchedulerBindingReadiness"));
assert(!runner.includes("--apply"));
assert(!runner.includes("writeDatabaseLifecycleReportSnapshot"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));

assert(routesSource.includes("/platform/engines/database-lifecycle/scheduler-bindings"));
assert(routesSource.includes("/platform/engines/database-lifecycle/scheduler-binding-readiness"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-bindings:"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-binding-readiness:"));
assert(openapi.includes("databaseLifecycleSchedulerBindings"));
assert(openapi.includes("databaseLifecycleSchedulerBindingReadiness"));

console.log("database lifecycle scheduler binding readiness tests passed");
