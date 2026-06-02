#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  applyDatabaseLifecycleSchedulerApproval,
  assertDatabaseLifecycleSchedulerApprovalAllowed,
  planDatabaseLifecycleSchedulerApproval,
} from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    confirm: "",
    decision: "",
    executor_policy_key: "",
    notification_target: "",
    reason: "",
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
  const gate = assertDatabaseLifecycleSchedulerApprovalAllowed(args);
  const pool = getPool();
  try {
    const plan = await planDatabaseLifecycleSchedulerApproval({ ...args, apply: gate.allowed }, { pool });
    const write_result = gate.allowed ? await applyDatabaseLifecycleSchedulerApproval(plan, { pool }) : null;
    console.log(JSON.stringify({
      ok: true,
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
    }, null, 2));
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
