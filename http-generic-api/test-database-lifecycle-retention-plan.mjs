import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDatabaseLifecycleRetentionPlan } from "./databaseTableLifecycle.js";

const script = fs.readFileSync(
  new URL("./scripts/database-lifecycle-retention-plan.mjs", import.meta.url),
  "utf8"
);

for (const destructiveSql of [
  /^\s*DROP\s+TABLE\b/mi,
  /^\s*TRUNCATE\s+TABLE\b/mi,
  /^\s*DELETE\s+FROM\b/mi,
  /^\s*UPDATE\b/mi,
  /^\s*INSERT\b/mi,
]) {
  assert(!destructiveSql.test(script), `retention plan script must be read-only and not include ${destructiveSql}`);
}

const plan = buildDatabaseLifecycleRetentionPlan([
  {
    table_name: "session_events",
    owner_engine_key: "session_memory_lifecycle_engine",
    usage_status: "runtime_log",
    risk_level: "high",
    approx_rows: 14225,
    size_mb: 38.922,
    retention_class: "hot_then_archive",
    retention_days: 45,
    archive_strategy: "summarize_then_archive",
    cleanup_strategy: "archive_after_summary_or_retention",
  },
  {
    table_name: "json_assets",
    owner_engine_key: "platform_graph_memory_lifecycle_engine",
    usage_status: "runtime_canonical",
    risk_level: "high",
    approx_rows: 3897,
    size_mb: 20.109,
    retention_class: "canonical_with_compaction",
    archive_strategy: "compact_superseded_versions",
    cleanup_strategy: "dedupe_and_compact",
  },
  {
    table_name: "repair_backup_sample",
    owner_engine_key: "repair_archive_engine",
    usage_status: "backup_snapshot",
    risk_level: "high",
    approx_rows: 10,
    size_mb: 1,
    retention_class: "temporary_repair_snapshot",
    retention_days: 90,
    archive_strategy: "retain_until_verified_replacement",
    cleanup_strategy: "archive_candidate_after_retention_and_approval",
  },
]);

assert.equal(plan.ok, true);
assert.equal(plan.dry_run, true);
assert.equal(plan.will_write, false);
assert.equal(plan.no_drop, true);
assert.equal(plan.no_delete, true);
assert.equal(plan.no_archive_execution, true);
assert.equal(plan.no_compaction_execution, true);
assert.equal(plan.secrets_included, false);
assert.equal(plan.summary.table_count, 3);
assert.equal(plan.summary.by_recommended_action.summarize_then_archive_plan, 1);
assert.equal(plan.summary.by_recommended_action.compaction_candidate_review, 1);
assert.equal(plan.summary.by_recommended_action.backup_snapshot_retention_review, 1);
assert(plan.actions.every((action) => action.execution_allowed === false));
assert(plan.actions.some((action) => action.reasons.includes("growth_hotspot")));

console.log("database lifecycle retention plan tests passed");
