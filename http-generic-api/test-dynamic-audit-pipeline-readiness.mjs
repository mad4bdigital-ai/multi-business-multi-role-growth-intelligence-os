import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/314_sprint69_dynamic_audit_runtime_closure.sql", import.meta.url),
  "utf8"
);
const runtime = readFileSync(new URL("./dynamicAuditRuntime.js", import.meta.url), "utf8");
const server = readFileSync(new URL("./server.js", import.meta.url), "utf8");

for (const token of [
  "dynamic_audit_scheduler_runs",
  "v_dynamic_audit_pipeline_counts",
  "v_dynamic_audit_pipeline_quality",
  "v_dynamic_audit_pipeline_readiness",
  "audit_log_to_event_bus_gap",
  "event_bus_unrolled_total",
  "event_bus_stale_pending_total",
  "scheduler_last_success_at",
  "repo_file_audit_run_total",
  "drive_asset_event_total",
  "drive_asset_readback_verified_total",
  "checkpoint_rollup_planned_total",
  "checkpoint_rollup_written_total",
  "db_change_semantics_unknown_total",
  "bad_evidence_rows",
  "duplicate_key_rows",
  "governed_platform_automation_tick",
]) {
  assert.match(migration, new RegExp(token));
}

assert.match(migration, /internal_runtime_interval_with_mysql_advisory_lock/);
assert.match(migration, /deployed_commit_sha_policy/);
assert.match(migration, /never_infer/);
assert.match(migration, /secrets_included=false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

for (const token of [
  "runDynamicAuditCycle",
  "startDynamicAuditScheduler",
  "GET_LOCK",
  "RELEASE_LOCK",
  "offsite_drive_upload_records",
  "session_drive_artifacts",
  "workspace_assets",
  "repo_file_audit_runs",
  "repo_file_audit_findings",
  "platform_evolution_checkpoints",
  "checkpoint_auto_rollups",
]) {
  assert.match(runtime, new RegExp(token));
}
assert.match(runtime, /deployed_commit_sha_intentionally_unset/);
assert.match(runtime, /dynamic_audit_runtime_fast/);
assert.match(runtime, /last_audit_log_id/);
assert.match(runtime, /full_quality_scan_deferred: true/);
assert.match(runtime, /runtime_config_disabled/);
assert.doesNotMatch(runtime, /SELECT \* FROM v_dynamic_audit_pipeline_readiness/);
assert.match(runtime, /raw_payload_stored: false/);
assert.match(runtime, /secrets_included: false/);
assert.match(server, /startDynamicAuditScheduler/);

console.log("Dynamic audit pipeline readiness and scheduler guard passed");
