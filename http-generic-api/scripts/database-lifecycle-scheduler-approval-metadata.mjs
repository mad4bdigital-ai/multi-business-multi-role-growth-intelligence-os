#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  applyDatabaseLifecycleSchedulerApproval,
  assertDatabaseLifecycleSchedulerApprovalAllowed,
  planDatabaseLifecycleSchedulerApproval,
  verifyDatabaseLifecycleSchedulerApprovalReadback,
} from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    confirm: "",
    decision: "",
    event_id: "",
    event_key: "",
    executor_policy_key: "",
    notification_target: "",
    reason: "",
    readback_only: false,
    target_key: "",
    target_type: "",
    trace_id: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--readback-only") {
      args.readback_only = true;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();
  try {
    if (args.readback_only) {
      const readback = await verifyDatabaseLifecycleSchedulerApprovalReadback(args, { pool });
      console.log(JSON.stringify({
        ok: readback.ok,
        mode: "readback",
        dry_run: true,
        will_execute: false,
        no_drop: true,
        no_delete: true,
        no_archive_execution: true,
        no_compaction_execution: true,
        secrets_included: false,
        readback,
      }, null, 2));
      return;
    }
    const gate = assertDatabaseLifecycleSchedulerApprovalAllowed(args);
    const plan = await planDatabaseLifecycleSchedulerApproval({ ...args, apply: gate.allowed }, { pool });
    const write_result = gate.allowed ? await applyDatabaseLifecycleSchedulerApproval(plan, { pool }) : null;
    const readback = write_result ? await verifyDatabaseLifecycleSchedulerApprovalReadback({
      target_type: write_result.target_type,
      target_key: write_result.target_key,
      event_id: write_result.event_id,
    }, { pool }) : null;
    const ok = !write_result || readback?.ok === true;
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
      plan,
      write_result,
      readback,
      readback_verified: readback ? readback.ok === true : false,
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_METADATA_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
