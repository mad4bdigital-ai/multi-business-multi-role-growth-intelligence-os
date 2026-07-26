import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDatabaseLifecycleOperationalStatus } from "./databaseTableLifecycle.js";

const routes = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/database-lifecycle-reporting-views.md", import.meta.url), "utf8");

const status = buildDatabaseLifecycleOperationalStatus({
  snapshots: [{
    snapshot_id: "snap_1",
    snapshot_key: "retention_plan:snap_1",
    report_type: "retention_plan",
    table_count: 12,
    approval_required_count: 3,
    high_risk_count: 2,
    archive_candidate_count: 1,
    dry_run: 0,
    created_at: "2026-06-03T00:00:00Z",
  }],
  schedules: [{
    schedule_key: "database_lifecycle_retention_plan_weekly",
    cron_expression: "0 3 * * 1",
    status: "active",
    approval_status: "approved",
  }],
  bindings: [{
    binding_key: "database_lifecycle_retention_plan_weekly_binding",
    status: "active",
    approval_status: "approved",
    will_execute: 0,
    no_drop: 1,
    no_delete: 1,
    no_archive_execution: 1,
    no_compaction_execution: 1,
    secrets_included: 0,
  }],
}, { now: "2026-06-03T06:00:00Z" });

assert.equal(status.ok, true);
assert.equal(status.status_type, "database_lifecycle_operational_status_v1");
assert.equal(status.operational_state, "ready");
assert.equal(status.dry_run, true);
assert.equal(status.will_execute, false);
assert.equal(status.no_drop, true);
assert.equal(status.no_delete, true);
assert.equal(status.no_archive_execution, true);
assert.equal(status.no_compaction_execution, true);
assert.equal(status.secrets_included, false);
assert.equal(status.latest_snapshot.snapshot_id, "snap_1");
assert.equal(status.snapshot_freshness.fresh, true);
assert.equal(status.snapshot_freshness.max_age_hours, 192);
assert.equal(status.summary.approved_schedule_count, 1);
assert.equal(status.summary.approved_binding_count, 1);
assert.deepEqual(status.blockers, []);

const blockedStatus = buildDatabaseLifecycleOperationalStatus({
  snapshots: [],
  schedules: [{ status: "planned_disabled", approval_status: "pending" }],
  bindings: [{
    status: "planned_disabled",
    approval_status: "pending",
    will_execute: 1,
    no_drop: 1,
    no_delete: 1,
    no_archive_execution: 1,
    no_compaction_execution: 1,
    secrets_included: 0,
  }],
});

assert.equal(blockedStatus.ok, false);
assert.equal(blockedStatus.operational_state, "needs_attention");
assert(blockedStatus.blockers.includes("no_lifecycle_report_snapshot_recorded"));
assert(blockedStatus.blockers.includes("no_active_snapshot_schedule"));
assert(blockedStatus.blockers.includes("no_approved_snapshot_schedule"));
assert(blockedStatus.blockers.includes("no_active_scheduler_binding"));
assert(blockedStatus.blockers.includes("no_approved_scheduler_binding"));
assert(blockedStatus.blockers.includes("scheduler_binding_guard_violation"));

const staleStatus = buildDatabaseLifecycleOperationalStatus({
  snapshots: [{
    snapshot_id: "snap_old",
    snapshot_key: "retention_plan:snap_old",
    report_type: "retention_plan",
    table_count: 12,
    created_at: "2026-06-01T00:00:00Z",
  }],
  schedules: [{
    schedule_key: "database_lifecycle_retention_plan_hourly",
    cron_expression: "0 * * * *",
    status: "active",
    approval_status: "approved",
  }],
  bindings: [{
    binding_key: "database_lifecycle_retention_plan_hourly_binding",
    status: "active",
    approval_status: "approved",
    will_execute: 0,
    no_drop: 1,
    no_delete: 1,
    no_archive_execution: 1,
    no_compaction_execution: 1,
    secrets_included: 0,
  }],
}, { now: "2026-06-03T06:00:00Z" });

assert.equal(staleStatus.ok, false);
assert.equal(staleStatus.snapshot_freshness.fresh, false);
assert.equal(staleStatus.snapshot_freshness.max_age_hours, 2);
assert(staleStatus.blockers.includes("latest_lifecycle_report_snapshot_stale"));

assert(routes.includes("getDatabaseLifecycleOperationalStatus"));
assert(routes.includes('router.get("/platform/engines/database-lifecycle/operational-status"'));
assert(openapi.includes("/platform/engines/database-lifecycle/operational-status"));
assert(openapi.includes("operationId: databaseLifecycleOperationalStatus"));
assert(openapi.includes("Read database lifecycle operational status"));
assert(openapi.includes("max_snapshot_age_hours"));
assert(docs.includes("Operational status"));
assert(docs.includes("database-lifecycle/operational-status"));
assert(docs.includes("latest_lifecycle_report_snapshot_stale"));
assert(manifest.includes("node test-database-lifecycle-operational-status.mjs"));

console.log("database lifecycle operational status tests passed");
