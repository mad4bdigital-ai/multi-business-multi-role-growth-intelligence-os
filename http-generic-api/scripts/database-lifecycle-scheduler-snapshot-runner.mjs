#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_BINDING_KEY,
  DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_KEY,
  runDatabaseLifecycleSchedulerSnapshot,
} from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    binding_key: DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_BINDING_KEY,
    confirm: "",
    limit: "",
    notes: "",
    schedule_key: DEFAULT_DATABASE_LIFECYCLE_SNAPSHOT_SCHEDULE_KEY,
    summary_only: false,
    tenant_id: "",
    trace_id: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--summary-only") {
      args.summary_only = true;
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
    const output = await runDatabaseLifecycleSchedulerSnapshot(args, { pool });
    console.log(JSON.stringify(output, null, 2));
    if (output.ok !== true) process.exitCode = 1;
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
