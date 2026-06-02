import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const DATABASE_TABLE_LIFECYCLE_UPSERT_CONFIRMATION = "APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT";
export const DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION = "APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT";
export const DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION = "APPROVE_DATABASE_LIFECYCLE_SCHEDULER_METADATA";

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

function retentionActionForRow(row = {}) {
  const tableName = text(row.table_name);
  const retentionClass = text(row.retention_class);
  const cleanupStrategy = text(row.cleanup_strategy);
  const archiveStrategy = text(row.archive_strategy);
  const usageStatus = text(row.usage_status);
  const ownerEngineKey = text(row.owner_engine_key);
  const sizeMb = number(row.size_mb);
  const approxRows = number(row.approx_rows);
  const riskLevel = text(row.risk_level || "medium");
  const reasons = [];

  let action = "review_policy";
  let execution_allowed = false;
  let requires_approval = riskLevel === "high" || riskLevel === "critical";
  let validator = "readback_registry_row";

  if (retentionClass === "hot_then_archive" && cleanupStrategy.includes("archive")) {
    action = ownerEngineKey === "session_memory_lifecycle_engine"
      ? "summarize_then_archive_plan"
      : "time_window_archive_plan";
    reasons.push("hot_log_retention_policy_present");
  } else if (retentionClass === "long_retention_archive") {
    action = "long_retention_archive_plan";
    reasons.push("long_retention_policy_present");
  } else if (retentionClass === "canonical_with_compaction" || cleanupStrategy.includes("compact")) {
    action = "compaction_candidate_review";
    reasons.push("canonical_compaction_policy_present");
  } else if (usageStatus === "backup_snapshot") {
    action = "backup_snapshot_retention_review";
    reasons.push("backup_snapshot_policy_present");
  } else if (usageStatus === "planned_placeholder") {
    action = "owner_or_archive_candidate_review";
    reasons.push("placeholder_requires_owner_or_review");
  } else {
    reasons.push("retention_policy_requires_review");
  }

  if (sizeMb >= 8 || approxRows >= 5000) reasons.push("growth_hotspot");
  if (archiveStrategy.includes("manual_review")) requires_approval = true;

  return {
    table_name: tableName,
    owner_engine_key: ownerEngineKey || "database_table_lifecycle_engine",
    usage_status: usageStatus || "manual_review",
    risk_level: riskLevel,
    approx_rows: approxRows,
    size_mb: sizeMb,
    retention_class: retentionClass || "requires_policy",
    retention_days: row.retention_days ?? null,
    archive_strategy: archiveStrategy || "manual_review",
    cleanup_strategy: cleanupStrategy || "none",
    recommended_action: action,
    execution_allowed,
    requires_approval,
    validator,
    reasons,
  };
}

export function buildDatabaseLifecycleRetentionPlan(rows = []) {
  const actions = rows
    .map(retentionActionForRow)
    .sort((left, right) => {
      const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const riskDelta = (riskOrder[right.risk_level] || 0) - (riskOrder[left.risk_level] || 0);
      if (riskDelta) return riskDelta;
      return number(right.size_mb) - number(left.size_mb);
    });
  const byAction = {};
  const byOwner = {};
  let approvalRequired = 0;
  for (const action of actions) {
    byAction[action.recommended_action] = (byAction[action.recommended_action] || 0) + 1;
    byOwner[action.owner_engine_key] = (byOwner[action.owner_engine_key] || 0) + 1;
    if (action.requires_approval) approvalRequired += 1;
  }
  return {
    ok: true,
    plan_type: "database_lifecycle_retention_plan_v1",
    dry_run: true,
    will_write: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    summary: {
      table_count: actions.length,
      approval_required_count: approvalRequired,
      by_recommended_action: byAction,
      by_owner_engine: byOwner,
    },
    actions,
    required_next_step: "review_actions_then_create_separate_governed_execution_runner",
    secrets_included: false,
  };
}

function snapshotCountsFromReport(report = {}) {
  const summary = report.summary || {};
  return {
    table_count: number(summary.table_count ?? report.table_count),
    approval_required_count: number(summary.approval_required_count),
    high_risk_count: number(summary.high_risk_count),
    archive_candidate_count: number(summary.archive_candidate_count),
  };
}

export function buildDatabaseLifecycleReportSnapshot(report = {}, options = {}) {
  const reportType = text(options.report_type || "retention_plan");
  const snapshotId = text(options.snapshot_id) || cryptoRandomId("dblrs");
  const snapshotKey = text(options.snapshot_key) || `${reportType}:${snapshotId}`;
  const counts = snapshotCountsFromReport(report);
  return {
    ok: true,
    snapshot_type: "database_lifecycle_report_snapshot_v1",
    snapshot_id: snapshotId,
    snapshot_key: snapshotKey,
    report_type: reportType,
    engine_key: text(options.engine_key || report.engine_key || "database_table_lifecycle_engine"),
    source_plan_type: text(report.plan_type || report.decision_brief_type),
    ...counts,
    summary: report.summary || {},
    report,
    source_options: {
      limit: options.limit ?? null,
      report_type: reportType,
    },
    dry_run: options.apply !== true,
    will_execute: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
    actor_id: text(options.actor_id),
    trace_id: text(options.trace_id),
    tenant_id: text(options.tenant_id),
    notes: text(options.notes),
    required_confirmation: DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
  };
}

function cryptoRandomId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function assertDatabaseLifecycleReportSnapshotAllowed({ apply = false, confirm } = {}) {
  if (!apply) {
    return {
      allowed: false,
      mode: "dry_run",
      required_confirmation: DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
    };
  }
  if (confirm !== DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION) {
    const err = new Error(`Apply requires --confirm ${DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION}.`);
    err.code = "DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION_REQUIRED";
    throw err;
  }
  return { allowed: true, mode: "apply" };
}

export async function writeDatabaseLifecycleReportSnapshot(snapshot = {}, deps = {}) {
  const pool = deps.pool || getPool();
  await pool.query(
    `INSERT INTO database_lifecycle_report_snapshots (
       snapshot_id, snapshot_key, report_type, engine_key, source_plan_type,
       table_count, approval_required_count, high_risk_count, archive_candidate_count,
       summary_json, report_json, source_options_json, dry_run, will_execute,
       no_drop, no_delete, no_archive_execution, no_compaction_execution,
       secrets_included, actor_id, trace_id, tenant_id, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       report_type = VALUES(report_type),
       engine_key = VALUES(engine_key),
       source_plan_type = VALUES(source_plan_type),
       table_count = VALUES(table_count),
       approval_required_count = VALUES(approval_required_count),
       high_risk_count = VALUES(high_risk_count),
       archive_candidate_count = VALUES(archive_candidate_count),
       summary_json = VALUES(summary_json),
       report_json = VALUES(report_json),
       source_options_json = VALUES(source_options_json),
       dry_run = VALUES(dry_run),
       will_execute = VALUES(will_execute),
       no_drop = VALUES(no_drop),
       no_delete = VALUES(no_delete),
       no_archive_execution = VALUES(no_archive_execution),
       no_compaction_execution = VALUES(no_compaction_execution),
       secrets_included = VALUES(secrets_included),
       actor_id = VALUES(actor_id),
       trace_id = VALUES(trace_id),
       tenant_id = VALUES(tenant_id),
       notes = VALUES(notes)`,
    [
      snapshot.snapshot_id,
      snapshot.snapshot_key,
      snapshot.report_type,
      snapshot.engine_key,
      snapshot.source_plan_type || null,
      snapshot.table_count,
      snapshot.approval_required_count,
      snapshot.high_risk_count,
      snapshot.archive_candidate_count,
      JSON.stringify(snapshot.summary || {}),
      JSON.stringify(snapshot.report || {}),
      JSON.stringify(snapshot.source_options || {}),
      snapshot.dry_run === true ? 1 : 0,
      0,
      1,
      1,
      1,
      1,
      0,
      snapshot.actor_id || null,
      snapshot.trace_id || null,
      snapshot.tenant_id || null,
      snapshot.notes || null,
    ]
  );
  return { snapshot_id: snapshot.snapshot_id, snapshot_key: snapshot.snapshot_key };
}

export async function listDatabaseLifecycleReportSnapshots({ report_type = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (report_type) {
    where.push("report_type = ?");
    params.push(text(report_type));
  }
  params.push(Math.max(1, Math.min(number(limit, 50), 250)));
  const [rows] = await pool.query(
    `SELECT snapshot_id, snapshot_key, report_type, engine_key, source_plan_type,
            table_count, approval_required_count, high_risk_count, archive_candidate_count,
            summary_json, source_options_json, dry_run, will_execute, no_drop, no_delete,
            no_archive_execution, no_compaction_execution, secrets_included,
            actor_id, trace_id, tenant_id, notes, created_at
       FROM database_lifecycle_report_snapshots
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT ?`,
    params
  );
  return rows;
}

function normalizeScheduleRow(row = {}) {
  return {
    schedule_key: text(row.schedule_key),
    report_type: text(row.report_type || "retention_plan"),
    engine_key: text(row.engine_key || "database_table_lifecycle_engine"),
    cron_expression: text(row.cron_expression),
    timezone: text(row.timezone || "UTC"),
    report_limit: number(row.report_limit, 80),
    snapshot_retention_days: number(row.snapshot_retention_days, 180),
    notification_target: text(row.notification_target),
    approval_status: text(row.approval_status || "pending"),
    approved_by: text(row.approved_by),
    approved_at: row.approved_at || null,
    status: text(row.status || "planned_disabled"),
    executor_policy_key: text(row.executor_policy_key),
    last_readiness_at: row.last_readiness_at || null,
    last_snapshot_id: text(row.last_snapshot_id),
    notes: text(row.notes),
  };
}

export function buildDatabaseLifecycleReportSnapshotScheduleReadiness(schedules = [], options = {}) {
  const normalized = schedules.map(normalizeScheduleRow);
  const readiness = normalized.map((schedule) => {
    const blockers = [];
    if (schedule.status !== "active") blockers.push("schedule_not_active");
    if (schedule.approval_status !== "approved") blockers.push("approval_not_approved");
    if (!schedule.notification_target) blockers.push("notification_target_missing");
    if (!schedule.executor_policy_key) blockers.push("executor_policy_missing");
    if (!schedule.cron_expression) blockers.push("cron_expression_missing");
    return {
      ...schedule,
      scheduler_ready: blockers.length === 0,
      will_execute: false,
      readiness_blockers: blockers,
    };
  });
  return {
    ok: true,
    readiness_type: "database_lifecycle_report_snapshot_schedule_readiness_v1",
    schedule_count: readiness.length,
    ready_count: readiness.filter((row) => row.scheduler_ready).length,
    blocked_count: readiness.filter((row) => !row.scheduler_ready).length,
    requested_schedule_key: text(options.schedule_key),
    requested_report_type: text(options.report_type),
    dry_run: true,
    will_execute: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
    required_next_step: "approve_schedule_metadata_then_bind_separate_scheduler_to_existing_snapshot_runner",
    schedules: readiness,
  };
}

export async function listDatabaseLifecycleReportSnapshotSchedules({ report_type = "", status = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (report_type) {
    where.push("report_type = ?");
    params.push(text(report_type));
  }
  if (status) {
    where.push("status = ?");
    params.push(text(status));
  }
  params.push(Math.max(1, Math.min(number(limit, 50), 250)));
  const [rows] = await pool.query(
    `SELECT schedule_key, report_type, engine_key, cron_expression, timezone,
            report_limit, snapshot_retention_days, notification_target,
            approval_status, approved_by, approved_at, status, executor_policy_key,
            last_readiness_at, last_snapshot_id, notes, created_at, updated_at
       FROM database_lifecycle_report_snapshot_schedules
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, schedule_key ASC
       LIMIT ?`,
    params
  );
  return rows;
}

export async function assessDatabaseLifecycleReportSnapshotScheduleReadiness({ schedule_key = "", report_type = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (schedule_key) {
    where.push("schedule_key = ?");
    params.push(text(schedule_key));
  }
  if (report_type) {
    where.push("report_type = ?");
    params.push(text(report_type));
  }
  params.push(Math.max(1, Math.min(number(limit, 50), 250)));
  const [rows] = await pool.query(
    `SELECT schedule_key, report_type, engine_key, cron_expression, timezone,
            report_limit, snapshot_retention_days, notification_target,
            approval_status, approved_by, approved_at, status, executor_policy_key,
            last_readiness_at, last_snapshot_id, notes
       FROM database_lifecycle_report_snapshot_schedules
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, schedule_key ASC
       LIMIT ?`,
    params
  );
  return buildDatabaseLifecycleReportSnapshotScheduleReadiness(rows, { schedule_key, report_type });
}

function normalizeSchedulerBindingRow(row = {}) {
  return {
    binding_key: text(row.binding_key),
    schedule_key: text(row.schedule_key),
    report_type: text(row.report_type),
    cron_expression: text(row.cron_expression),
    timezone: text(row.timezone || "UTC"),
    runner_key: text(row.runner_key || "database_lifecycle_report_snapshot_runner"),
    runner_command: text(row.runner_command),
    scheduler_surface: text(row.scheduler_surface || "external_scheduler"),
    executor_policy_key: text(row.executor_policy_key),
    notification_target: text(row.notification_target),
    approval_status: text(row.approval_status || "pending"),
    status: text(row.status || "planned_disabled"),
    schedule_status: text(row.schedule_status),
    schedule_approval_status: text(row.schedule_approval_status),
    dry_run_required: row.dry_run_required !== false && row.dry_run_required !== 0,
    confirmation_required: row.confirmation_required !== false && row.confirmation_required !== 0,
    readback_required: row.readback_required !== false && row.readback_required !== 0,
    will_execute: row.will_execute === true || row.will_execute === 1,
    no_drop: row.no_drop !== false && row.no_drop !== 0,
    no_delete: row.no_delete !== false && row.no_delete !== 0,
    no_archive_execution: row.no_archive_execution !== false && row.no_archive_execution !== 0,
    no_compaction_execution: row.no_compaction_execution !== false && row.no_compaction_execution !== 0,
    secrets_included: row.secrets_included === true || row.secrets_included === 1,
    notes: text(row.notes),
  };
}

export function buildDatabaseLifecycleSchedulerBindingReadiness(bindings = [], options = {}) {
  const normalized = bindings.map(normalizeSchedulerBindingRow);
  const readiness = normalized.map((binding) => {
    const blockers = [];
    if (binding.status !== "active") blockers.push("binding_not_active");
    if (binding.approval_status !== "approved") blockers.push("binding_approval_not_approved");
    if (binding.schedule_status && binding.schedule_status !== "active") blockers.push("schedule_not_active");
    if (binding.schedule_approval_status && binding.schedule_approval_status !== "approved") blockers.push("schedule_approval_not_approved");
    if (!binding.notification_target) blockers.push("notification_target_missing");
    if (!binding.executor_policy_key) blockers.push("executor_policy_missing");
    if (!binding.runner_command) blockers.push("runner_command_missing");
    if (!binding.confirmation_required) blockers.push("confirmation_gate_missing");
    if (!binding.readback_required) blockers.push("readback_gate_missing");
    if (binding.will_execute) blockers.push("binding_marked_executable");
    if (!binding.no_drop || !binding.no_delete || !binding.no_archive_execution || !binding.no_compaction_execution) blockers.push("destructive_guard_missing");
    if (binding.secrets_included) blockers.push("secrets_flagged_in_binding");
    return {
      ...binding,
      binding_ready: blockers.length === 0,
      will_execute: false,
      readiness_blockers: blockers,
    };
  });
  return {
    ok: true,
    readiness_type: "database_lifecycle_scheduler_binding_readiness_v1",
    binding_count: readiness.length,
    ready_count: readiness.filter((row) => row.binding_ready).length,
    blocked_count: readiness.filter((row) => !row.binding_ready).length,
    requested_binding_key: text(options.binding_key),
    requested_schedule_key: text(options.schedule_key),
    dry_run: true,
    will_execute: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
    required_next_step: "approve_scheduler_binding_then_run_external_scheduler_dry_run_with_snapshot_readback",
    bindings: readiness,
  };
}

export async function listDatabaseLifecycleSchedulerBindings({ schedule_key = "", status = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (schedule_key) {
    where.push("b.schedule_key = ?");
    params.push(text(schedule_key));
  }
  if (status) {
    where.push("b.status = ?");
    params.push(text(status));
  }
  params.push(Math.max(1, Math.min(number(limit, 50), 250)));
  const [rows] = await pool.query(
    `SELECT b.binding_key, b.schedule_key, s.report_type, s.cron_expression, s.timezone,
            b.runner_key, b.runner_command, b.scheduler_surface, b.executor_policy_key,
            b.notification_target, b.approval_status, b.status, s.status AS schedule_status,
            s.approval_status AS schedule_approval_status, b.dry_run_required,
            b.confirmation_required, b.readback_required, b.will_execute,
            b.no_drop, b.no_delete, b.no_archive_execution, b.no_compaction_execution,
            b.secrets_included, b.notes, b.created_at, b.updated_at
       FROM database_lifecycle_report_snapshot_scheduler_bindings b
       LEFT JOIN database_lifecycle_report_snapshot_schedules s
         ON s.schedule_key = b.schedule_key
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY b.updated_at DESC, b.binding_key ASC
       LIMIT ?`,
    params
  );
  return rows;
}

export async function assessDatabaseLifecycleSchedulerBindingReadiness({ binding_key = "", schedule_key = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (binding_key) {
    where.push("b.binding_key = ?");
    params.push(text(binding_key));
  }
  if (schedule_key) {
    where.push("b.schedule_key = ?");
    params.push(text(schedule_key));
  }
  params.push(Math.max(1, Math.min(number(limit, 50), 250)));
  const [rows] = await pool.query(
    `SELECT b.binding_key, b.schedule_key, s.report_type, s.cron_expression, s.timezone,
            b.runner_key, b.runner_command, b.scheduler_surface, b.executor_policy_key,
            b.notification_target, b.approval_status, b.status, s.status AS schedule_status,
            s.approval_status AS schedule_approval_status, b.dry_run_required,
            b.confirmation_required, b.readback_required, b.will_execute,
            b.no_drop, b.no_delete, b.no_archive_execution, b.no_compaction_execution,
            b.secrets_included, b.notes
       FROM database_lifecycle_report_snapshot_scheduler_bindings b
       LEFT JOIN database_lifecycle_report_snapshot_schedules s
         ON s.schedule_key = b.schedule_key
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY b.updated_at DESC, b.binding_key ASC
       LIMIT ?`,
    params
  );
  return buildDatabaseLifecycleSchedulerBindingReadiness(rows, { binding_key, schedule_key });
}

function normalizeSchedulerApprovalInput(input = {}) {
  const targetType = lower(input.target_type || input.targetType);
  const targetKey = text(input.target_key || input.targetKey);
  const decision = lower(input.decision);
  if (!["schedule", "binding"].includes(targetType)) {
    const err = new Error("target_type must be schedule or binding.");
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_TARGET_TYPE_INVALID";
    err.status = 400;
    throw err;
  }
  if (!targetKey) {
    const err = new Error("target_key is required.");
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_TARGET_KEY_REQUIRED";
    err.status = 400;
    throw err;
  }
  if (!["approve", "reject", "revoke"].includes(decision)) {
    const err = new Error("decision must be approve, reject, or revoke.");
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_DECISION_INVALID";
    err.status = 400;
    throw err;
  }
  return {
    target_type: targetType,
    target_key: targetKey,
    decision,
    notification_target: text(input.notification_target || input.notificationTarget),
    executor_policy_key: text(input.executor_policy_key || input.executorPolicyKey),
    actor_id: text(input.actor_id || input.actorId || input.requested_by),
    trace_id: text(input.trace_id || input.traceId),
    reason: text(input.reason || input.notes),
    apply: input.apply === true,
    confirm: text(input.confirm),
  };
}

function schedulerApprovalNextState(input = {}, current = {}) {
  if (input.decision === "approve") {
    return {
      next_status: "active",
      next_approval_status: "approved",
      notification_target: input.notification_target || text(current.notification_target),
      executor_policy_key: input.executor_policy_key || text(current.executor_policy_key),
    };
  }
  if (input.decision === "reject") {
    return {
      next_status: "planned_disabled",
      next_approval_status: "rejected",
      notification_target: input.notification_target || text(current.notification_target),
      executor_policy_key: input.executor_policy_key || text(current.executor_policy_key),
    };
  }
  return {
    next_status: "planned_disabled",
    next_approval_status: "revoked",
    notification_target: input.notification_target || text(current.notification_target),
    executor_policy_key: input.executor_policy_key || text(current.executor_policy_key),
  };
}

export function buildDatabaseLifecycleSchedulerApprovalPlan(input = {}, current = {}) {
  const normalized = normalizeSchedulerApprovalInput(input);
  const next = schedulerApprovalNextState(normalized, current);
  const blockers = [];
  if (normalized.decision === "approve" && !next.notification_target) blockers.push("notification_target_required_for_approval");
  if (normalized.decision === "approve" && !next.executor_policy_key) blockers.push("executor_policy_key_required_for_approval");
  return {
    ok: blockers.length === 0,
    plan_type: "database_lifecycle_scheduler_approval_metadata_plan_v1",
    target_type: normalized.target_type,
    target_key: normalized.target_key,
    decision: normalized.decision,
    previous_status: text(current.status),
    previous_approval_status: text(current.approval_status),
    ...next,
    actor_id: normalized.actor_id,
    trace_id: normalized.trace_id,
    reason: normalized.reason,
    dry_run: !normalized.apply,
    will_execute: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
    required_confirmation: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
    blocked_reasons: blockers,
    required_next_step: blockers.length ? "supply_required_approval_metadata" : "apply_with_typed_confirmation_to_record_metadata_only",
  };
}

export function assertDatabaseLifecycleSchedulerApprovalAllowed({ apply = false, confirm } = {}) {
  if (!apply) {
    return {
      allowed: false,
      mode: "dry_run",
      required_confirmation: DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION,
    };
  }
  if (confirm !== DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION) {
    const err = new Error(`Apply requires --confirm ${DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION}.`);
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_CONFIRMATION_REQUIRED";
    err.status = 400;
    throw err;
  }
  return { allowed: true, mode: "apply" };
}

async function loadSchedulerApprovalTarget(pool, input) {
  const table = input.target_type === "schedule"
    ? "database_lifecycle_report_snapshot_schedules"
    : "database_lifecycle_report_snapshot_scheduler_bindings";
  const keyColumn = input.target_type === "schedule" ? "schedule_key" : "binding_key";
  const [rows] = await pool.query(
    `SELECT * FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`,
    [input.target_key]
  );
  return rows[0] || null;
}

export async function planDatabaseLifecycleSchedulerApproval(input = {}, deps = {}) {
  const normalized = normalizeSchedulerApprovalInput(input);
  const pool = deps.pool || getPool();
  const current = await loadSchedulerApprovalTarget(pool, normalized);
  if (!current) {
    const err = new Error(`${normalized.target_type} target not found.`);
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_TARGET_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  return buildDatabaseLifecycleSchedulerApprovalPlan(normalized, current);
}

export async function applyDatabaseLifecycleSchedulerApproval(plan = {}, deps = {}) {
  if (!plan.ok) {
    const err = new Error("Scheduler approval plan is blocked.");
    err.code = "DATABASE_LIFECYCLE_SCHEDULER_APPROVAL_PLAN_BLOCKED";
    err.status = 409;
    throw err;
  }
  const pool = deps.pool || getPool();
  const eventId = cryptoRandomId("dblsa");
  const eventKey = `${plan.target_type}:${plan.target_key}:${plan.decision}:${eventId}`;
  if (plan.target_type === "schedule") {
    await pool.query(
      `UPDATE database_lifecycle_report_snapshot_schedules
          SET status = ?, approval_status = ?, approved_by = ?,
              approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,
              notification_target = ?, executor_policy_key = ?, notes = ?
        WHERE schedule_key = ?`,
      [
        plan.next_status,
        plan.next_approval_status,
        plan.actor_id || null,
        plan.next_approval_status,
        plan.notification_target || null,
        plan.executor_policy_key || null,
        plan.reason || null,
        plan.target_key,
      ]
    );
  } else {
    await pool.query(
      `UPDATE database_lifecycle_report_snapshot_scheduler_bindings
          SET status = ?, approval_status = ?, approved_by = ?,
              approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,
              notification_target = ?, executor_policy_key = ?, notes = ?,
              will_execute = 0, no_drop = 1, no_delete = 1,
              no_archive_execution = 1, no_compaction_execution = 1,
              secrets_included = 0
        WHERE binding_key = ?`,
      [
        plan.next_status,
        plan.next_approval_status,
        plan.actor_id || null,
        plan.next_approval_status,
        plan.notification_target || null,
        plan.executor_policy_key || null,
        plan.reason || null,
        plan.target_key,
      ]
    );
  }
  await pool.query(
    `INSERT INTO database_lifecycle_scheduler_approval_events (
       event_id, event_key, target_type, target_key, decision,
       previous_status, previous_approval_status, next_status, next_approval_status,
       notification_target, executor_policy_key, actor_id, trace_id, reason,
       dry_run, will_execute, no_drop, no_delete, no_archive_execution,
       no_compaction_execution, secrets_included
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 1, 1, 1, 0)`,
    [
      eventId,
      eventKey,
      plan.target_type,
      plan.target_key,
      plan.decision,
      plan.previous_status || null,
      plan.previous_approval_status || null,
      plan.next_status,
      plan.next_approval_status,
      plan.notification_target || null,
      plan.executor_policy_key || null,
      plan.actor_id || null,
      plan.trace_id || null,
      plan.reason || null,
    ]
  );
  return { event_id: eventId, event_key: eventKey, target_type: plan.target_type, target_key: plan.target_key };
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

export async function planDatabaseLifecycleRetentionReview({ limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT table_name, table_family, owner_engine_key, usage_status, risk_level,
            approx_rows, size_mb, retention_class, retention_days,
            archive_strategy, cleanup_strategy, growth_policy, status, notes, last_checked_at
       FROM database_table_lifecycle_registry
      WHERE risk_level IN ('high', 'critical')
         OR COALESCE(size_mb, 0) >= 5
         OR COALESCE(approx_rows, 0) >= 5000
         OR usage_status IN ('backup_snapshot', 'planned_placeholder')
      ORDER BY
        CASE risk_level WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        COALESCE(size_mb, 0) DESC,
        COALESCE(approx_rows, 0) DESC,
        table_name ASC
      LIMIT ?`,
    [Math.max(1, Math.min(number(limit, 50), 500))]
  );
  return buildDatabaseLifecycleRetentionPlan(rows);
}
