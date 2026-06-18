import assert from "node:assert/strict";
import fs from "node:fs";
import {
  writeDatabaseLifecycleSchedulerSnapshot,
} from "./databaseTableLifecycle.js";
import {
  databaseLifecycleDailyWindowStart,
  isDatabaseLifecycleDailySnapshotDue,
  parseDatabaseLifecycleDailyCron,
} from "./databaseLifecycleDailyRuntime.js";

const migration = fs.readFileSync(
  new URL("./migrations/318_sprint69_database_lifecycle_daily_snapshot_runtime.sql", import.meta.url),
  "utf8"
);
const dynamicRuntime = fs.readFileSync(
  new URL("./dynamicAuditRuntime.js", import.meta.url),
  "utf8"
);

assert.deepEqual(parseDatabaseLifecycleDailyCron("0 3 * * *", "UTC"), {
  minute: 0,
  hour: 3,
  timezone: "UTC",
});
assert.equal(parseDatabaseLifecycleDailyCron("0 3 * * 1", "UTC"), null);
assert.equal(parseDatabaseLifecycleDailyCron("0 3 * * *", "Africa/Cairo"), null);

assert.equal(
  databaseLifecycleDailyWindowStart({
    now: "2026-06-18T02:30:00.000Z",
    cron_expression: "0 3 * * *",
    timezone: "UTC",
  }).toISOString(),
  "2026-06-17T03:00:00.000Z"
);
assert.equal(
  databaseLifecycleDailyWindowStart({
    now: "2026-06-18T03:05:00.000Z",
    cron_expression: "0 3 * * *",
    timezone: "UTC",
  }).toISOString(),
  "2026-06-18T03:00:00.000Z"
);
assert.equal(isDatabaseLifecycleDailySnapshotDue({
  now: "2026-06-18T03:05:00.000Z",
  last_readiness_at: "2026-06-17T03:01:00.000Z",
}).due, true);
assert.equal(isDatabaseLifecycleDailySnapshotDue({
  now: "2026-06-18T03:05:00.000Z",
  last_readiness_at: "2026-06-18T03:01:00.000Z",
}).due, false);
assert.equal(isDatabaseLifecycleDailySnapshotDue({
  now: "2026-06-18T02:30:00.000Z",
  last_readiness_at: "2026-06-17T03:01:00.000Z",
}).due, false);
assert.equal(isDatabaseLifecycleDailySnapshotDue({
  now: "2026-06-18T03:05:00.000Z",
  cron_expression: "0 3 * * 1",
}).reason, "unsupported_daily_schedule");

function snapshot(id = "dblrs_test_daily") {
  return {
    snapshot_id: id,
    snapshot_key: `retention_plan:${id}`,
    report_type: "retention_plan",
    engine_key: "database_table_lifecycle_engine",
    source_plan_type: "database_lifecycle_retention_plan_v1",
    table_count: 12,
    approval_required_count: 3,
    high_risk_count: 0,
    archive_candidate_count: 0,
    summary: {},
    report: {},
    source_options: { limit: 1000, report_type: "retention_plan" },
    dry_run: false,
    actor_id: "tester",
    trace_id: "trace_daily",
    tenant_id: "",
    notes: "daily test",
  };
}

function fakeConnection({ readbackSnapshotId = "dblrs_test_daily", updateAffectedRows = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async query(sql) {
      calls.push(sql);
      if (sql.includes("INSERT INTO database_lifecycle_report_snapshots")) return [{ affectedRows: 1 }];
      if (sql.includes("UPDATE database_lifecycle_report_snapshot_schedules")) return [{ affectedRows: updateAffectedRows }];
      if (sql.includes("SELECT schedule_key,last_readiness_at,last_snapshot_id")) {
        return [[{
          schedule_key: "database_lifecycle_snapshot_daily",
          last_readiness_at: "2026-06-18T03:00:01.000Z",
          last_snapshot_id: readbackSnapshotId,
          updated_at: "2026-06-18T03:00:01.000Z",
        }]];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

const successConnection = fakeConnection();
const successResult = await writeDatabaseLifecycleSchedulerSnapshot(
  snapshot(),
  { schedule_key: "database_lifecycle_snapshot_daily" },
  { connection: successConnection }
);
assert.equal(successResult.schedule_readback.verified, true);
assert.equal(successResult.schedule_readback.last_snapshot_id, "dblrs_test_daily");
assert(successConnection.calls.includes("begin"));
assert(successConnection.calls.includes("commit"));
assert(!successConnection.calls.includes("rollback"));
assert(!successConnection.calls.includes("release"), "caller-owned connection must not be released");

const mismatchConnection = fakeConnection({ readbackSnapshotId: "dblrs_wrong" });
await assert.rejects(
  () => writeDatabaseLifecycleSchedulerSnapshot(
    snapshot(),
    { schedule_key: "database_lifecycle_snapshot_daily" },
    { connection: mismatchConnection }
  ),
  (error) => error?.code === "DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_READBACK_FAILED"
);
assert(mismatchConnection.calls.includes("rollback"));
assert(!mismatchConnection.calls.includes("commit"));

const missingScheduleConnection = fakeConnection({ updateAffectedRows: 0 });
await assert.rejects(
  () => writeDatabaseLifecycleSchedulerSnapshot(
    snapshot(),
    { schedule_key: "database_lifecycle_snapshot_daily" },
    { connection: missingScheduleConnection }
  ),
  (error) => error?.code === "DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_UPDATE_FAILED"
);
assert(missingScheduleConnection.calls.includes("rollback"));
assert(!missingScheduleConnection.calls.includes("commit"));

for (const marker of [
  "no_provider_call true",
  "no_credential_payload_read true",
  "no_raw_secrets true",
  "no_external_send true",
  "no_external_write true",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), `migration must include safety marker ${marker}`);
}
assert(migration.includes("'database_lifecycle_snapshot_daily'"));
assert(migration.includes("'database_lifecycle_snapshot_daily_binding'"));
assert(migration.includes("'0 3 * * *'"));
assert(migration.includes("'0 3 * * 1'"));
assert(migration.includes("scheduler_surface='manual_review'"));
assert(migration.includes("will_execute=0"));
assert(!/\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i.test(migration));
assert(dynamicRuntime.includes("runDatabaseLifecycleDailySnapshotCycle"));
assert(dynamicRuntime.includes("lifecycle_snapshot: lifecycleSnapshot"));

console.log("database lifecycle daily snapshot runtime tests passed");
