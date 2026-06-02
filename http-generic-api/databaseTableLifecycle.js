import { getPool } from "./db.js";

export const DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION = "APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT";

function text(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function includesAny(value, patterns = []) {
  const haystack = lower(value);
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function classifyDatabaseTableLifecycle(row = {}) {
  const tableName = text(row.table_name || row.TABLE_NAME);
  const rows = number(row.approx_rows ?? row.table_rows ?? row.TABLE_ROWS);
  const sizeMb = number(row.size_mb);
  const columnNames = Array.isArray(row.column_names)
    ? row.column_names.map(lower)
    : text(row.column_names).split(",").map(lower).filter(Boolean);
  const hasTenant = columnNames.includes("tenant_id");
  const hasUser = columnNames.includes("user_id");
  const hasStatus = columnNames.includes("status");
  const hasUpdated = columnNames.includes("updated_at") || columnNames.includes("last_updated_at");
  const inventoryStatus = lower(row.migration_status);

  let tableFamily = "uncategorized";
  let ownerEngineKey = "database_table_lifecycle_engine";
  let usageStatus = "manual_review";
  let retentionClass = "standard";
  let retentionDays = null;
  let archiveStrategy = "manual_review";
  let cleanupStrategy = "none";
  let riskLevel = "medium";
  const reasons = [];

  if (["session_events", "gpt_session_turns", "session_turns", "customer_sessions"].includes(tableName)) {
    tableFamily = "session_log";
    ownerEngineKey = "session_memory_lifecycle_engine";
    usageStatus = rows > 0 ? "runtime_log" : "planned_placeholder";
    retentionClass = "hot_then_archive";
    retentionDays = tableName === "gpt_session_turns" ? 60 : 45;
    archiveStrategy = "summarize_then_archive";
    cleanupStrategy = "archive_after_summary_or_retention";
    riskLevel = sizeMb > 10 ? "high" : "medium";
    reasons.push("session_or_turn_table");
  } else if (["audit_log", "execution_log", "telemetry_spans"].includes(tableName)) {
    tableFamily = tableName === "telemetry_spans" ? "telemetry_log" : "audit_execution_log";
    ownerEngineKey = "observability_lifecycle_engine";
    usageStatus = rows > 0 ? "runtime_log" : "planned_placeholder";
    retentionClass = tableName === "audit_log" ? "long_retention_archive" : "hot_then_archive";
    retentionDays = tableName === "audit_log" ? 365 : tableName === "telemetry_spans" ? 30 : 90;
    archiveStrategy = "time_window_archive";
    cleanupStrategy = "archive_by_time_window";
    riskLevel = sizeMb > 8 ? "high" : "medium";
    reasons.push("audit_or_observability_table");
  } else if (["json_assets", "platform_graph_nodes", "platform_graph_edges"].includes(tableName)) {
    tableFamily = tableName === "json_assets" ? "artifact_store" : "platform_graph";
    ownerEngineKey = "platform_graph_memory_lifecycle_engine";
    usageStatus = rows > 0 ? "runtime_canonical" : "planned_placeholder";
    retentionClass = "canonical_with_compaction";
    retentionDays = null;
    archiveStrategy = "compact_superseded_versions";
    cleanupStrategy = "dedupe_and_compact";
    riskLevel = sizeMb > 10 ? "high" : "medium";
    reasons.push("graph_or_artifact_authority");
  } else if (/^(repair_backup_|rb_|collation_backup_|zz_collation_backup_)/i.test(tableName)) {
    tableFamily = "backup_repair_snapshot";
    ownerEngineKey = "repair_archive_engine";
    usageStatus = "backup_snapshot";
    retentionClass = "temporary_repair_snapshot";
    retentionDays = 90;
    archiveStrategy = "retain_until_verified_replacement";
    cleanupStrategy = "archive_candidate_after_retention_and_approval";
    riskLevel = "high";
    reasons.push("backup_or_repair_snapshot");
  } else if (includesAny(tableName, ["browser_runtime", "browser_", "native_browser"])) {
    tableFamily = "browser_runtime";
    ownerEngineKey = "browser_runtime_engine";
    usageStatus = rows > 0 ? "runtime_registry" : "planned_placeholder";
    retentionClass = "registry";
    archiveStrategy = "archive_disabled_rows";
    cleanupStrategy = "expire_stale_runs";
    riskLevel = "medium";
    reasons.push("browser_runtime_family");
  } else if (includesAny(tableName, ["plugin", "app_action", "action_grant", "smoke_certification"])) {
    tableFamily = "platform_plugin";
    ownerEngineKey = "provider_smoke_certification_engine";
    usageStatus = rows > 0 ? "runtime_registry" : "planned_placeholder";
    retentionClass = "registry";
    archiveStrategy = "archive_disabled_rows";
    cleanupStrategy = "expire_failed_drafts";
    riskLevel = "medium";
    reasons.push("plugin_or_provider_family");
  } else if (includesAny(tableName, ["credit", "commercial", "usage_limit", "usage_meter", "subscription", "entitlement"])) {
    tableFamily = "commercial";
    ownerEngineKey = "commercial_lifecycle_engine";
    usageStatus = rows > 0 ? "runtime_canonical" : "planned_placeholder";
    retentionClass = "business_record";
    archiveStrategy = "manual_review";
    cleanupStrategy = "none";
    riskLevel = "high";
    reasons.push("commercial_or_entitlement_table");
  } else if (rows === 0 && inventoryStatus === "deprecated") {
    tableFamily = "deprecated";
    usageStatus = "archive_candidate";
    retentionClass = "deprecated_empty";
    retentionDays = 30;
    archiveStrategy = "drop_candidate_after_review";
    cleanupStrategy = "manual_drop_migration_only";
    riskLevel = "medium";
    reasons.push("empty_deprecated_inventory");
  } else if (rows === 0) {
    tableFamily = "empty_or_placeholder";
    usageStatus = "planned_placeholder";
    retentionClass = "placeholder";
    retentionDays = 180;
    archiveStrategy = "require_owner_or_archive_candidate";
    cleanupStrategy = "mark_archive_candidate_if_unlinked";
    riskLevel = hasTenant || hasUser || hasStatus ? "medium" : "low";
    reasons.push("empty_table");
  } else {
    tableFamily = hasTenant ? "tenant_scoped_runtime" : "runtime_or_registry";
    usageStatus = inventoryStatus === "deprecated" ? "archive_candidate" : "runtime_unclassified";
    retentionClass = "requires_policy";
    archiveStrategy = "manual_review";
    cleanupStrategy = "assign_owner_engine";
    riskLevel = sizeMb > 8 || rows > 100000 ? "high" : "medium";
    reasons.push("unclassified_non_empty_table");
  }

  return {
    table_name: tableName,
    table_family: tableFamily,
    owner_engine_key: ownerEngineKey,
    authority_model: row.authority_model || (usageStatus.includes("canonical") ? "canonical" : "derived"),
    usage_status: usageStatus,
    write_strategy: row.write_strategy || (usageStatus.includes("snapshot") ? "read_only" : "platform_primary"),
    retention_class: retentionClass,
    retention_days: retentionDays,
    archive_strategy: archiveStrategy,
    cleanup_strategy: cleanupStrategy,
    growth_policy: riskLevel === "high" ? "monitor_size_and_rows" : "standard_monitoring",
    approx_rows: rows,
    size_mb: sizeMb,
    linked_by_code: Boolean(row.linked_by_code),
    linked_by_policy: Boolean(row.linked_by_policy || row.inventory_registered),
    linked_by_foreign_key: Boolean(row.linked_by_foreign_key || number(row.foreign_key_count) > 0),
    risk_level: riskLevel,
    status: usageStatus === "archive_candidate" ? "review" : "active",
    classification_reasons: reasons,
    last_observed_write_at: row.update_time || row.last_observed_write_at || null,
  };
}

function buildLifecycleSummary(rows = []) {
  const byStatus = {};
  const byFamily = {};
  let highRisk = 0;
  let archiveCandidates = 0;
  for (const row of rows) {
    byStatus[row.usage_status] = (byStatus[row.usage_status] || 0) + 1;
    byFamily[row.table_family] = (byFamily[row.table_family] || 0) + 1;
    if (row.risk_level === "high") highRisk += 1;
    if (row.usage_status === "archive_candidate" || /archive_candidate/.test(row.cleanup_strategy)) archiveCandidates += 1;
  }
  return {
    table_count: rows.length,
    high_risk_count: highRisk,
    archive_candidate_count: archiveCandidates,
    by_usage_status: byStatus,
    by_table_family: byFamily,
  };
}

function lifecycleBucket(row) {
  if (["planned_placeholder", "manual_review"].includes(row.usage_status)) {
    return "link_to_engine_policy_audit";
  }
  if (row.usage_status === "archive_candidate" || /archive_candidate/.test(row.cleanup_strategy)) {
    return "archive_candidate";
  }
  if (row.usage_status === "runtime_unclassified" || row.owner_engine_key === "database_table_lifecycle_engine") {
    return "unlinked";
  }
  if (row.owner_engine_key && ["runtime_canonical", "runtime_derived", "runtime_registry", "runtime_log", "backup_snapshot"].includes(row.usage_status)) {
    return "clearly_used";
  }
  return "link_to_engine_policy_audit";
}

function buildLifecycleBuckets(rows = []) {
  const buckets = {
    clearly_used: [],
    unlinked: [],
    archive_candidate: [],
    link_to_engine_policy_audit: [],
  };
  for (const row of rows) {
    buckets[lifecycleBucket(row)].push(row.table_name);
  }
  return buckets;
}

export function buildDatabaseTableLifecycleDecisionBrief(rows = []) {
  const classified = rows.map(classifyDatabaseTableLifecycle);
  const summary = buildLifecycleSummary(classified);
  return {
    ok: true,
    decision_brief_type: "database_table_lifecycle_decision_brief_v1",
    engine_key: "database_table_lifecycle_engine",
    recommended_decision: "register_lifecycle_metadata",
    no_drop: true,
    no_archive_execution: true,
    summary,
    buckets: buildLifecycleBuckets(classified),
    priority_actions: [
      "register_all_untracked_tables_in_lifecycle_registry",
      "assign_owner_engine_for_unclassified_non_empty_tables",
      "add_retention_policy_for_high_growth_logs",
      "mark_backup_repair_snapshots_with_retention_and_review_gate",
      "convert_empty_unlinked_tables_to_owner_or_archive_candidate_review",
    ],
    tables: classified,
  };
}

export function buildDatabaseTableLifecycleRegisterPlan(rows = []) {
  const classified = rows.map(classifyDatabaseTableLifecycle);
  const upsertRows = classified.map((row) => ({
    table_name: row.table_name,
    table_family: row.table_family,
    owner_engine_key: row.owner_engine_key,
    authority_model: row.authority_model,
    usage_status: row.usage_status,
    write_strategy: row.write_strategy,
    retention_class: row.retention_class,
    retention_days: row.retention_days,
    archive_strategy: row.archive_strategy,
    cleanup_strategy: row.cleanup_strategy,
    growth_policy: row.growth_policy,
    approx_rows: row.approx_rows,
    size_mb: row.size_mb,
    last_observed_write_at: row.last_observed_write_at,
    linked_by_code: row.linked_by_code,
    linked_by_policy: row.linked_by_policy,
    linked_by_foreign_key: row.linked_by_foreign_key,
    risk_level: row.risk_level,
    status: row.status,
    notes: row.classification_reasons.join(","),
  }));
  return {
    ok: true,
    plan_type: "database_table_lifecycle_register_plan_v1",
    dry_run: true,
    will_write: false,
    no_drop: true,
    no_archive_execution: true,
    target_table: "database_table_lifecycle_registry",
    summary: buildLifecycleSummary(classified),
    buckets: buildLifecycleBuckets(classified),
    upsert_count: upsertRows.length,
    upsert_rows: upsertRows,
    required_next_step: "review_then_run_separate_governed_registry_upsert",
  };
}

export function assertDatabaseTableLifecycleRegistryUpsertAllowed({ apply = false, confirm } = {}) {
  if (!apply) {
    return {
      allowed: false,
      mode: "dry_run",
      required_confirmation: DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION,
    };
  }
  if (confirm !== DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION) {
    const err = new Error(`Apply requires --confirm ${DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION}.`);
    err.code = "DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION_REQUIRED";
    throw err;
  }
  return { allowed: true, mode: "apply" };
}

async function loadDatabaseLifecycleRows(pool) {
  const [rows] = await pool.query(
    `SELECT
       t.table_name,
       t.table_type,
       COALESCE(t.table_rows, 0) AS approx_rows,
       ROUND((COALESCE(t.data_length, 0) + COALESCE(t.index_length, 0)) / 1024 / 1024, 3) AS size_mb,
       t.update_time,
       t.create_time,
       GROUP_CONCAT(c.column_name ORDER BY c.ordinal_position SEPARATOR ',') AS column_names,
       COUNT(DISTINCT k.constraint_name) AS foreign_key_count,
       dmi.authority_model,
       dmi.write_strategy,
       dmi.migration_status,
       dmi.table_name IS NOT NULL AS inventory_registered
     FROM information_schema.tables t
     LEFT JOIN information_schema.columns c
       ON c.table_schema = t.table_schema AND c.table_name = t.table_name
     LEFT JOIN information_schema.key_column_usage k
       ON k.table_schema = t.table_schema
      AND k.table_name = t.table_name
      AND k.referenced_table_name IS NOT NULL
     LEFT JOIN data_migration_inventory dmi
       ON dmi.table_name = t.table_name
     WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE'
     GROUP BY t.table_name, t.table_type, t.table_rows, t.data_length, t.index_length,
              t.update_time, t.create_time, dmi.authority_model, dmi.write_strategy,
              dmi.migration_status, dmi.table_name
     ORDER BY size_mb DESC, t.table_name`
  );
  return rows;
}

export async function runDatabaseTableLifecycleCensus({ limit = 250 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const rows = await loadDatabaseLifecycleRows(pool);
  const capped = rows.slice(0, Math.max(1, Math.min(number(limit, 250), 1000)));
  return buildDatabaseTableLifecycleDecisionBrief(capped);
}

export async function planDatabaseTableLifecycleRegistryUpsert({ limit = 250 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const rows = await loadDatabaseLifecycleRows(pool);
  const capped = rows.slice(0, Math.max(1, Math.min(number(limit, 250), 1000)));
  return buildDatabaseTableLifecycleRegisterPlan(capped);
}
