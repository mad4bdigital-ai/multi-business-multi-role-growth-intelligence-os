#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  assertDatabaseLifecycleReportSnapshotAllowed,
  buildDatabaseLifecycleReportSnapshot,
  planDatabaseLifecycleRetentionReview,
  writeDatabaseLifecycleReportSnapshot,
} from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = {
    actor_id: "",
    apply: false,
    confirm: "",
    limit: 50,
    notes: "",
    report_type: "retention_plan",
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

async function buildReport(args, pool) {
  if (args.report_type !== "retention_plan") {
    const err = new Error("Only report_type=retention_plan is supported by this runner.");
    err.code = "DATABASE_LIFECYCLE_REPORT_TYPE_UNSUPPORTED";
    throw err;
  }
  return planDatabaseLifecycleRetentionReview({ limit: args.limit }, { pool });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertDatabaseLifecycleReportSnapshotAllowed(args);
  const pool = getPool();
  try {
    const report = await buildReport(args, pool);
    const snapshot = buildDatabaseLifecycleReportSnapshot(report, {
      ...args,
      apply: gate.allowed,
    });
    let write_result = null;
    if (gate.allowed) {
      write_result = await writeDatabaseLifecycleReportSnapshot(snapshot, { pool });
    }
    console.log(JSON.stringify({
      ok: true,
      mode: gate.mode,
      dry_run: !gate.allowed,
      will_write: gate.allowed,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
      snapshot,
      write_result,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_REPORT_SNAPSHOT_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
