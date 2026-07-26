#!/usr/bin/env node
import { getPool } from "../db.js";
import { assessDatabaseLifecycleSchedulerBindingReadiness } from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = {
    binding_key: "",
    limit: 50,
    schedule_key: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    const readiness = await assessDatabaseLifecycleSchedulerBindingReadiness(args, { pool });
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      will_execute: false,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
      readiness,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_SCHEDULER_BINDING_READINESS_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
