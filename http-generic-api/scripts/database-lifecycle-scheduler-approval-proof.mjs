#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  applyDatabaseLifecycleSchedulerApproval,
  assertDatabaseLifecycleSchedulerApprovalAllowed,
  DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
  planDatabaseLifecycleSchedulerApproval,
  verifyDatabaseLifecycleSchedulerApprovalReadback,
} from "../databaseTableLifecycle.js";

const DEFAULT_SCHEDULE_KEY = "database_lifecycle_retention_plan_weekly";
const DEFAULT_BINDING_KEY = "database_lifecycle_retention_plan_weekly_binding";
const DEFAULT_EXECUTOR_POLICY_KEY = "database_lifecycle_report_snapshot_schedule_policy_v1";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    binding_key: DEFAULT_BINDING_KEY,
    confirm: "",
    decision: "approve",
    executor_policy_key: DEFAULT_EXECUTOR_POLICY_KEY,
    notification_target: "",
    reason: "",
    schedule_key: DEFAULT_SCHEDULE_KEY,
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

async function planTarget(pool, args, targetType, targetKey) {
  return planDatabaseLifecycleSchedulerApproval({
    target_type: targetType,
    target_key: targetKey,
    decision: args.decision,
    notification_target: args.notification_target,
    executor_policy_key: args.executor_policy_key,
    actor_id: args.actor_id,
    trace_id: args.trace_id,
    reason: args.reason,
    apply: args.apply,
  }, { pool });
}

async function readbackTarget(pool, writeResult, targetType, targetKey) {
  return verifyDatabaseLifecycleSchedulerApprovalReadback({
    target_type: writeResult?.target_type || targetType,
    target_key: writeResult?.target_key || targetKey,
    event_id: writeResult?.event_id || "",
  }, { pool });
}

async function runTarget(pool, args, targetType, targetKey, gate) {
  const plan = await planTarget(pool, args, targetType, targetKey);
  const write_result = gate.allowed ? await applyDatabaseLifecycleSchedulerApproval(plan, { pool }) : null;
  const readback = gate.allowed ? await readbackTarget(pool, write_result, targetType, targetKey) : null;
  return {
    target_type: targetType,
    target_key: targetKey,
    plan,
    write_result,
    readback,
    readback_verified: readback ? readback.ok === true : false,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && args.confirm !== DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION) {
    assertDatabaseLifecycleSchedulerApprovalAllowed({ apply: true, confirm: args.confirm });
  }
  const gate = assertDatabaseLifecycleSchedulerApprovalAllowed({ apply: args.apply, confirm: args.confirm });
  const pool = getPool();
  try {
    const targets = [
      await runTarget(pool, args, "schedule", args.schedule_key, gate),
      await runTarget(pool, args, "binding", args.binding_key, gate),
    ];
    const blocked = targets.flatMap((target) => target.plan?.blocked_reasons || []);
    const readbackFailures = targets
      .filter((target) => gate.allowed && target.readback_verified !== true)
      .map((target) => ({
        target_type: target.target_type,
        target_key: target.target_key,
        blockers: target.readback?.verification_blockers || ["readback_missing"],
      }));
    const ok = blocked.length === 0 && readbackFailures.length === 0;
    console.log(JSON.stringify({
      ok,
      mode: gate.mode,
      dry_run: !gate.allowed,
      will_write: gate.allowed,
      will_execute: false,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
      required_confirmation: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
      targets,
      blocked_reasons: [...new Set(blocked)],
      readback_failures: readbackFailures,
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_PROOF_FAILED",
    message: err.message,
    required_confirmation: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
