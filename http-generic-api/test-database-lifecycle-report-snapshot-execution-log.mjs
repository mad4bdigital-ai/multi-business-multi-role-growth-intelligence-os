import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/database-lifecycle-report-snapshot.mjs", "utf8");

assert(
  runner.includes('import { writeExecutionEvidence } from "../executionEvidenceLogger.js"') &&
    runner.includes('entryType: "database_lifecycle_report_snapshot_refresh"') &&
    runner.includes('toolKey: "database_lifecycle_report_snapshot_refresh"') &&
    runner.includes("execution_log"),
  "database lifecycle snapshot runner must attempt bounded execution_log evidence on apply"
);

assert(
  runner.includes("write_result = await writeDatabaseLifecycleReportSnapshot(snapshot, { pool })") &&
    runner.indexOf("write_result = await writeDatabaseLifecycleReportSnapshot(snapshot, { pool })") <
      runner.indexOf("await writeExecutionEvidence({"),
  "execution_log evidence must be attempted only after snapshot table write succeeds"
);

assert(
  runner.includes("execution_log.error = { code: err.code || \"execution_log_write_failed\", message: err.message }"),
  "execution_log failure must be returned separately from snapshot write result"
);

for (const expected of [
  "no_drop: true",
  "no_delete: true",
  "no_archive_execution: true",
  "no_compaction_execution: true",
  "secrets_included: false",
]) {
  assert(runner.includes(expected), `execution_log output summary must preserve ${expected}`);
}

assert.doesNotMatch(
  runner,
  /credential|password|private_key|cf_token|connector_secret|api_key/i,
  "database lifecycle snapshot execution evidence must not reference secret-bearing fields"
);

console.log("database lifecycle report snapshot execution_log guard passed");
