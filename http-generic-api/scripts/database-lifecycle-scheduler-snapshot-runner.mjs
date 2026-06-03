#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  assertDatabaseLifecycleReportSnapshotAllowed,
  assessDatabaseLifecycleReportSnapshotScheduleReadiness,
  assessDatabaseLifecycleSchedulerBindingReadiness,
  buildDatabaseLifecycleReportSnapshot,
  planDatabaseLifecycleRetentionReview,
  verifyDatabaseLifecycleSchedulerApprovalReadback,
  writeDatabaseLifecycleReportSnapshot,
} from "../databaseTableLifecycle.js";

const DEFAULT_SCHEDULE_KEY = "database_lifecycle_retention_plan_weekly";
const DEFAULT_BINDING_KEY = "database_lifecycle_retention_plan_weekly_binding";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    binding_key: DEFAULT_BINDING_KEY,
    confirm: "",
    limit: "",
    notes: "",
    schedule_key: DEFAULT_SCHEDULE_KEY,
    tenant_id: "",
    trace_id: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const name = arg.slice(2).replace(/-/g, "_");
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    args[name] = argv[index + 1] || "";
    index += 1;
  }
  return args;
}

function firstReady(rows = [], readyKey) {
  return (rows || []).find((row) => row?.[readyKey] === true) || null;
}

function collectBlockers(scheduleReadiness, bindingReadiness, approvalReadbacks = []) {
  const blockers = [];
  if (!scheduleReadiness?.scheduler_ready) {
    blockers.push(...(scheduleReadiness?.readiness_blockers || ["schedule_not_ready"]));
  }
  if (!bindingReadiness?.binding_ready) {
    blockers.push(...(bindingReadiness?.readiness_blockers || ["binding_not_ready"]));
  }
  for (const readback of approvalReadbacks) {
    if (readback?.ok !== true) {
      blockers.push(...(readback?.verification_blockers || [`${readback?.target_type || "approval"}_readback_not_verified`]));
    }
  }
  return [...new Set(blockers)];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertDatabaseLifecycleReportSnapshotAllowed(args);
  const pool = getPool();
  try {
    const schedule = await assessDatabaseLifecycleReportSnapshotScheduleReadiness({
      schedule_key: args.schedule_key,
      report_type: "retention_plan",
      limit: 1,
    }, { pool });
    const binding = await assessDatabaseLifecycleSchedulerBindingReadiness({
      binding_key: args.binding_key,
      schedule_key: args.schedule_key,
      limit: 1,
    }, { pool });
    const scheduleRow = firstReady(schedule.schedules, "scheduler_ready") || schedule.schedules?.[0] || null;
    const bindingRow = firstReady(binding.bindings, "binding_ready") || binding.bindings?.[0] || null;
    const scheduleApprovalReadback = await verifyDatabaseLifecycleSchedulerApprovalReadback({
      target_type: "schedule",
      target_key: args.schedule_key,
    }, { pool });
    const bindingApprovalReadback = await verifyDatabaseLifecycleSchedulerApprovalReadback({
      target_type: "binding",
      target_key: args.binding_key,
    }, { pool });
    const blockers = collectBlockers(scheduleRow, bindingRow, [scheduleApprovalReadback, bindingApprovalReadback]);
    const limit = args.limit || scheduleRow?.report_limit || 80;
    const report = await planDatabaseLifecycleRetentionReview({ limit }, { pool });
    const snapshot = buildDatabaseLifecycleReportSnapshot(report, {
      actor_id: args.actor_id,
      apply: gate.allowed && blockers.length === 0,
      limit,
      notes: args.notes || `scheduler:${args.schedule_key};binding:${args.binding_key}`,
      report_type: "retention_plan",
      tenant_id: args.tenant_id,
      trace_id: args.trace_id,
    });
    const write_result = gate.allowed && blockers.length === 0
      ? await writeDatabaseLifecycleReportSnapshot(snapshot, { pool })
      : null;
    const ok = blockers.length === 0;
    console.log(JSON.stringify({
      ok,
      mode: gate.mode,
      dry_run: !gate.allowed,
      will_write: gate.allowed && blockers.length === 0,
      will_execute: false,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
      schedule_readiness: schedule,
      binding_readiness: binding,
      approval_readback: {
        schedule: scheduleApprovalReadback,
        binding: bindingApprovalReadback,
      },
      blocked_reasons: blockers,
      snapshot,
      write_result,
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_SCHEDULER_SNAPSHOT_RUNNER_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
