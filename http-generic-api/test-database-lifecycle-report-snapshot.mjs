import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertDatabaseLifecycleReportSnapshotAllowed,
  buildDatabaseLifecycleReportSnapshot,
  DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
  writeDatabaseLifecycleReportSnapshot,
} from "./databaseTableLifecycle.js";

const migration = fs.readFileSync(
  new URL("./migrations/182_sprint66_database_lifecycle_report_snapshots.sql", import.meta.url),
  "utf8"
);
const runner = fs.readFileSync(
  new URL("./scripts/database-lifecycle-report-snapshot.mjs", import.meta.url),
  "utf8"
);
const routesSource = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshots"));
assert(migration.includes("v_database_lifecycle_report_snapshot_summary"));
assert(migration.includes("database_lifecycle_report_snapshot_create"));
assert(migration.includes("database_lifecycle_report_snapshots"));
for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+TABLE\s+database_table_lifecycle_registry\b/i]) {
  assert(!forbidden.test(migration), `snapshot migration must not include destructive operation: ${forbidden}`);
}

const report = {
  ok: true,
  plan_type: "database_lifecycle_retention_plan_v1",
  dry_run: true,
  will_write: false,
  no_drop: true,
  no_delete: true,
  no_archive_execution: true,
  no_compaction_execution: true,
  secrets_included: false,
  summary: {
    table_count: 3,
    approval_required_count: 2,
    by_recommended_action: {
      backup_snapshot_retention_review: 1,
    },
  },
  actions: [
    { table_name: "session_events", risk_level: "high", recommended_action: "summarize_then_archive_plan" },
    { table_name: "repair_backup_actions", risk_level: "high", recommended_action: "backup_snapshot_retention_review" },
  ],
};

const snapshot = buildDatabaseLifecycleReportSnapshot(report, {
  report_type: "retention_plan",
  limit: 50,
  actor_id: "tester",
});
assert.equal(snapshot.ok, true);
assert.equal(snapshot.snapshot_type, "database_lifecycle_report_snapshot_v1");
assert.equal(snapshot.report_type, "retention_plan");
assert.equal(snapshot.source_plan_type, "database_lifecycle_retention_plan_v1");
assert.equal(snapshot.table_count, 3);
assert.equal(snapshot.approval_required_count, 2);
assert.equal(snapshot.dry_run, true);
assert.equal(snapshot.will_execute, false);
assert.equal(snapshot.no_drop, true);
assert.equal(snapshot.no_delete, true);
assert.equal(snapshot.no_archive_execution, true);
assert.equal(snapshot.no_compaction_execution, true);
assert.equal(snapshot.secrets_included, false);
assert.equal(snapshot.required_confirmation, DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION);

assert.deepEqual(assertDatabaseLifecycleReportSnapshotAllowed({ apply: false }), {
  allowed: false,
  mode: "dry_run",
  required_confirmation: DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
});
assert.throws(
  () => assertDatabaseLifecycleReportSnapshotAllowed({ apply: true, confirm: "wrong" }),
  /APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT/
);
assert.equal(assertDatabaseLifecycleReportSnapshotAllowed({
  apply: true,
  confirm: DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
}).allowed, true);

let captured = null;
const fakePool = {
  async query(sql, params) {
    captured = { sql, params };
    return [{ affectedRows: 1 }];
  },
};
await writeDatabaseLifecycleReportSnapshot({
  ...snapshot,
  dry_run: false,
}, { pool: fakePool });
assert(captured.sql.includes("INSERT INTO database_lifecycle_report_snapshots"));
assert.equal(captured.params[2], "retention_plan");
assert.equal(captured.params[12], 0, "applied snapshot write should mark dry_run false");
assert.equal(captured.params[13], 0, "snapshot writes must not execute lifecycle actions");
assert.equal(captured.params[14], 1, "snapshot writes preserve no_drop");
assert.equal(captured.params[15], 1, "snapshot writes preserve no_delete");
assert.equal(captured.params[16], 1, "snapshot writes preserve no_archive_execution");
assert.equal(captured.params[17], 1, "snapshot writes preserve no_compaction_execution");
assert.equal(captured.params[18], 0, "snapshot writes must not include secrets");

assert(runner.includes("assertDatabaseLifecycleReportSnapshotAllowed"));
assert(runner.includes("--apply"));
assert(runner.includes("confirm"));
assert(!runner.includes("DROP TABLE"));
assert(!runner.includes("DELETE FROM"));

assert(routesSource.includes("/platform/engines/database-lifecycle/report-snapshots"));
assert(routesSource.includes("assertDatabaseLifecycleReportSnapshotAllowed"));
assert(routesSource.includes("writeDatabaseLifecycleReportSnapshot"));
assert(openapi.includes("/platform/engines/database-lifecycle/report-snapshots:"));
assert(openapi.includes("databaseLifecycleReportSnapshotCreate"));
assert(openapi.includes("databaseLifecycleReportSnapshots"));

console.log("database lifecycle report snapshot tests passed");
