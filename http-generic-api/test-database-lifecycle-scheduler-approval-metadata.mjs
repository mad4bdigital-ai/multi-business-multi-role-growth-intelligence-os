import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyDatabaseLifecycleSchedulerApproval,
  assertDatabaseLifecycleSchedulerApprovalAllowed,
  buildDatabaseLifecycleSchedulerApprovalPlan,
  buildDatabaseLifecycleSchedulerApprovalReadback,
  DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
  planDatabaseLifecycleSchedulerApproval,
  verifyDatabaseLifecycleSchedulerApprovalReadback,
} from "./databaseTableLifecycle.js";

const migration = fs.readFileSync(
  new URL("./migrations/185_sprint66_database_lifecycle_scheduler_approval_metadata.sql", import.meta.url),
  "utf8"
);
const readbackMigration = fs.readFileSync(
  new URL("./migrations/186_sprint66_database_lifecycle_scheduler_approval_readback.sql", import.meta.url),
  "utf8"
);
const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-scheduler-approval-metadata.mjs", import.meta.url),
  "utf8"
);
const proofRunner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-scheduler-approval-proof.mjs", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const releaseReadiness = fs.readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const governedMigrationRunner = fs.readFileSync(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8"
);

assert(migration.includes("CREATE TABLE IF NOT EXISTS database_lifecycle_scheduler_approval_events"));
assert(migration.includes("database_lifecycle_scheduler_approval_metadata"));
assert(migration.includes("confirmation_required"));
assert(migration.includes("typed_confirmation_required"));
assert(readbackMigration.includes("database_lifecycle_scheduler_approval_readback"));
assert(readbackMigration.includes("read_only"));
assert(
  releaseReadiness.includes("186_sprint66_database_lifecycle_scheduler_approval_readback.sql"),
  "release readiness governed ledger expectation must include migration 186"
);
assert(
  governedMigrationRunner.includes("186_sprint66_database_lifecycle_scheduler_approval_readback.sql"),
  "governed migration runner allowlist must include migration 186"
);
for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+database_table_lifecycle_registry\b/i]) {
  assert(!forbidden.test(migration), `approval metadata migration must not include destructive operation: ${forbidden}`);
  assert(!forbidden.test(readbackMigration), `approval readback migration must not include destructive operation: ${forbidden}`);
}

const approvalPlan = buildDatabaseLifecycleSchedulerApprovalPlan({
  target_type: "schedule",
  target_key: "database_lifecycle_retention_plan_weekly",
  decision: "approve",
  notification_target: "admin_ops",
  executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
  actor_id: "tester",
}, {
  schedule_key: "database_lifecycle_retention_plan_weekly",
  status: "planned_disabled",
  approval_status: "pending",
});
assert.equal(approvalPlan.ok, true);
assert.equal(approvalPlan.plan_type, "database_lifecycle_scheduler_approval_metadata_plan_v1");
assert.equal(approvalPlan.next_status, "active");
assert.equal(approvalPlan.next_approval_status, "approved");
assert.equal(approvalPlan.dry_run, true);
assert.equal(approvalPlan.will_execute, false);
assert.equal(approvalPlan.no_drop, true);
assert.equal(approvalPlan.no_delete, true);
assert.equal(approvalPlan.no_archive_execution, true);
assert.equal(approvalPlan.no_compaction_execution, true);
assert.equal(approvalPlan.secrets_included, false);
assert.equal(approvalPlan.required_confirmation, DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION);

const blockedPlan = buildDatabaseLifecycleSchedulerApprovalPlan({
  target_type: "binding",
  target_key: "database_lifecycle_retention_plan_weekly_binding",
  decision: "approve",
}, {
  binding_key: "database_lifecycle_retention_plan_weekly_binding",
  status: "planned_disabled",
  approval_status: "pending",
});
assert.equal(blockedPlan.ok, false);
assert(blockedPlan.blocked_reasons.includes("notification_target_required_for_approval"));
assert(blockedPlan.blocked_reasons.includes("executor_policy_key_required_for_approval"));

assert.deepEqual(assertDatabaseLifecycleSchedulerApprovalAllowed({ apply: false }), {
  allowed: false,
  mode: "dry_run",
  required_confirmation: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
});
assert.throws(
  () => assertDatabaseLifecycleSchedulerApprovalAllowed({ apply: true, confirm: "wrong" }),
  /APPROVE_DATABASE_LIFECYCLE_SCHEDULER_METADATA/
);
assert.equal(assertDatabaseLifecycleSchedulerApprovalAllowed({
  apply: true,
  confirm: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
}).allowed, true);

const readbackPlan = buildDatabaseLifecycleSchedulerApprovalReadback({
  target_type: "binding",
  target_key: "database_lifecycle_retention_plan_weekly_binding",
  event_id: "dblsa_test",
}, {
  binding_key: "database_lifecycle_retention_plan_weekly_binding",
  status: "active",
  approval_status: "approved",
  notification_target: "admin_ops",
  executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
  will_execute: 0,
  no_drop: 1,
  no_delete: 1,
  no_archive_execution: 1,
  no_compaction_execution: 1,
  secrets_included: 0,
}, {
  event_id: "dblsa_test",
  event_key: "binding:database_lifecycle_retention_plan_weekly_binding:approve:dblsa_test",
  target_type: "binding",
  target_key: "database_lifecycle_retention_plan_weekly_binding",
  decision: "approve",
  next_status: "active",
  next_approval_status: "approved",
  notification_target: "admin_ops",
  executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
  will_execute: 0,
  no_drop: 1,
  no_delete: 1,
  no_archive_execution: 1,
  no_compaction_execution: 1,
  secrets_included: 0,
});
assert.equal(readbackPlan.ok, true);
assert.equal(readbackPlan.readback_type, "database_lifecycle_scheduler_approval_metadata_readback_v1");
assert.equal(readbackPlan.verified, true);
assert.equal(readbackPlan.will_execute, false);
assert.equal(readbackPlan.secrets_included, false);

let captured = [];
let approvalApplied = false;
const fakePool = {
  async query(sql, params) {
    captured.push({ sql, params });
    if (sql.includes("FROM database_lifecycle_report_snapshot_schedules")) {
      return [[{
        schedule_key: "database_lifecycle_retention_plan_weekly",
        status: approvalApplied ? "active" : "planned_disabled",
        approval_status: approvalApplied ? "approved" : "pending",
        notification_target: approvalApplied ? "admin_ops" : null,
        executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
      }]];
    }
    if (sql.includes("FROM database_lifecycle_scheduler_approval_events")) {
      return [[{
        event_id: "dblsa_test",
        event_key: "schedule:database_lifecycle_retention_plan_weekly:approve:dblsa_test",
        target_type: "schedule",
        target_key: "database_lifecycle_retention_plan_weekly",
        decision: "approve",
        next_status: "active",
        next_approval_status: "approved",
        notification_target: "admin_ops",
        executor_policy_key: "database_lifecycle_report_snapshot_schedule_policy_v1",
        will_execute: 0,
        no_drop: 1,
        no_delete: 1,
        no_archive_execution: 1,
        no_compaction_execution: 1,
        secrets_included: 0,
      }]];
    }
    if (sql.includes("UPDATE database_lifecycle_report_snapshot_schedules")) {
      approvalApplied = true;
    }
    return [{ affectedRows: 1 }];
  },
};

const planned = await planDatabaseLifecycleSchedulerApproval({
  target_type: "schedule",
  target_key: "database_lifecycle_retention_plan_weekly",
  decision: "approve",
  notification_target: "admin_ops",
  actor_id: "tester",
}, { pool: fakePool });
assert.equal(planned.ok, true);
assert(captured[0].sql.includes("SELECT * FROM database_lifecycle_report_snapshot_schedules"));

captured = [];
const writeResult = await applyDatabaseLifecycleSchedulerApproval(planned, { pool: fakePool });
assert(writeResult.event_id.startsWith("dblsa_"));
assert(captured[0].sql.includes("UPDATE database_lifecycle_report_snapshot_schedules"));
assert(captured[1].sql.includes("INSERT INTO database_lifecycle_scheduler_approval_events"));
assert.equal(captured[0].params[0], "active");
assert.equal(captured[0].params[1], "approved");
assert.equal(captured[1].params[4], "approve");

captured = [];
const verifiedReadback = await verifyDatabaseLifecycleSchedulerApprovalReadback({
  target_type: "schedule",
  target_key: "database_lifecycle_retention_plan_weekly",
  event_id: "dblsa_test",
}, { pool: fakePool });
assert.equal(verifiedReadback.ok, true);
assert(captured[0].sql.includes("FROM database_lifecycle_report_snapshot_schedules"));
assert(captured[1].sql.includes("FROM database_lifecycle_scheduler_approval_events"));

assert(runner.includes("assertDatabaseLifecycleSchedulerApprovalAllowed"));
assert(runner.includes("--apply"));
assert(runner.includes("--readback-only"));
assert(runner.includes("confirm"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));
assert(proofRunner.includes("DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION"));
assert(proofRunner.includes("readback_verified"));
assert(proofRunner.includes("will_execute: false"));
assert(proofRunner.includes("no_drop: true"));
assert(proofRunner.includes("no_delete: true"));
assert(proofRunner.includes("no_archive_execution: true"));
assert(proofRunner.includes("no_compaction_execution: true"));
assert(!proofRunner.includes("DROP TABLE"));
assert(!proofRunner.includes("DELETE FROM"));
assert(routesSource.includes("/platform/engines/database-lifecycle/scheduler-approval-metadata"));
assert(routesSource.includes("/platform/engines/database-lifecycle/scheduler-approval-readback"));
assert(routesSource.includes("assertDatabaseLifecycleSchedulerApprovalAllowed"));
assert(routesSource.includes("applyDatabaseLifecycleSchedulerApproval"));
assert(routesSource.includes("verifyDatabaseLifecycleSchedulerApprovalReadback"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-approval-metadata:"));
assert(openapi.includes("/platform/engines/database-lifecycle/scheduler-approval-readback:"));
assert(openapi.includes("databaseLifecycleSchedulerApprovalMetadata"));
assert(openapi.includes("databaseLifecycleSchedulerApprovalReadback"));

console.log("database lifecycle scheduler approval metadata tests passed");
