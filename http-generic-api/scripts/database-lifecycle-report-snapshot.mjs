#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  assertDatabaseLifecycleReportSnapshotAllowed,
  buildDatabaseLifecycleReportSnapshot,
  planDatabaseLifecycleRetentionReview,
  writeDatabaseLifecycleReportSnapshot,
} from "../databaseTableLifecycle.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

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
    let execution_log = { trace_id: null, recorded: false, error: null };
    if (gate.allowed) {
      write_result = await writeDatabaseLifecycleReportSnapshot(snapshot, { pool });
      if (snapshot.trace_id) {
        execution_log.trace_id = snapshot.trace_id;
        try {
          await writeExecutionEvidence({
            pool,
            traceId: snapshot.trace_id,
            entryType: "database_lifecycle_report_snapshot_refresh",
            executionClass: "governed_operational_snapshot",
            sourceLayer: "database_lifecycle_report_snapshot_runner",
            executionMode: "apply",
            decisionTrigger: "database_lifecycle_snapshot_refresh",
            executionStatus: "success",
            outputSummary: {
              snapshot_id: snapshot.snapshot_id,
              snapshot_key: snapshot.snapshot_key,
              report_type: snapshot.report_type,
              table_count: snapshot.table_count,
              approval_required_count: snapshot.approval_required_count,
              no_drop: true,
              no_delete: true,
              no_archive_execution: true,
              no_compaction_execution: true,
              secrets_included: false,
            },
            tenantId: snapshot.tenant_id || null,
            actorId: snapshot.actor_id || null,
            actorType: "codex_operator",
            toolKey: "database_lifecycle_report_snapshot_refresh",
            resourceType: "database_lifecycle_report_snapshot",
            resourceId: snapshot.snapshot_id,
            targetType: "database_lifecycle_report_snapshots",
            targetId: snapshot.snapshot_key,
            engineKey: snapshot.engine_key,
            policyKeys: "database_lifecycle_report_snapshot_policy_v1",
            runtimeEvidence: { script: "scripts/database-lifecycle-report-snapshot.mjs", snapshot_key: snapshot.snapshot_key, secrets_included: false },
            skipSurfaceAuthority: true,
          });
          execution_log.recorded = true;
        } catch (err) {
          execution_log.error = { code: err.code || "execution_log_write_failed", message: err.message };
        }
      }
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
      execution_log,
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
