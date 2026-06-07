#!/usr/bin/env node

import { getPool } from "../db.js";

const MIGRATIONS = [
  "203_sprint67_execution_log_context_dimensions.sql",
  "204_sprint67_core_runtime_context_dimensions.sql",
  "205_sprint67_runtime_context_dimension_enrichment.sql",
];

const EXECUTION_LOG_COLUMNS = [
  "tenant_id",
  "workspace_id",
  "user_id",
  "actor_id",
  "brand_id",
  "brand_key",
  "request_id",
  "session_id",
  "conversation_id",
  "resource_type",
  "resource_id",
  "correlation_id",
  "execution_context_json",
];

const LIFECYCLE_VIEWS = [
  "v_database_lifecycle_status_summary",
  "v_database_lifecycle_owner_coverage",
  "v_database_lifecycle_growth_hotspots",
  "v_database_lifecycle_placeholder_review",
  "v_database_lifecycle_high_risk_review",
  "v_database_lifecycle_credential_review",
  "v_database_lifecycle_backup_snapshot_review",
  "v_database_lifecycle_report_snapshot_summary",
];

function numeric(value) {
  return Number(value || 0);
}

function normalizeCoverageRow(row = {}) {
  return {
    table_name: row.table_name,
    total_rows: numeric(row.total_rows),
    tenant_rows: numeric(row.tenant_rows),
    user_rows: numeric(row.user_rows),
    actor_rows: numeric(row.actor_rows),
    brand_rows: numeric(row.brand_rows),
    workspace_rows: numeric(row.workspace_rows),
    correlation_rows: numeric(row.correlation_rows),
    context_json_rows: numeric(row.context_json_rows),
  };
}

async function safeRows(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error?.code || error?.message || String(error),
    };
  }
}

export async function runPlatformRecompositionLiveReadback({ pool = getPool() } = {}) {
  const [
    ledger,
    executionLogColumns,
    executionLogCoverage,
    coreCoverage,
    enrichmentCoverage,
    lifecycleRegistry,
    lifecycleViews,
    lifecycleStatus,
    lifecycleSnapshots,
  ] = await Promise.all([
    safeRows(
      pool,
      `SELECT migration_file, mode, applied_at
         FROM governed_migration_ledger
        WHERE migration_file IN (?, ?, ?)
        ORDER BY applied_at DESC`,
      MIGRATIONS
    ),
    safeRows(
      pool,
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'execution_log'
          AND column_name IN (${EXECUTION_LOG_COLUMNS.map(() => "?").join(", ")})
        ORDER BY column_name`,
      EXECUTION_LOG_COLUMNS
    ),
    safeRows(
      pool,
      `SELECT COUNT(*) AS total_rows,
              SUM(tenant_id IS NOT NULL) AS tenant_rows,
              SUM(workspace_id IS NOT NULL OR workspace_key IS NOT NULL) AS workspace_rows,
              SUM(user_id IS NOT NULL) AS user_rows,
              SUM(actor_id IS NOT NULL) AS actor_rows,
              SUM(brand_id IS NOT NULL OR brand_key IS NOT NULL) AS brand_rows,
              SUM(request_id IS NOT NULL) AS request_rows,
              SUM(session_id IS NOT NULL) AS session_rows,
              SUM(conversation_id IS NOT NULL) AS conversation_rows,
              SUM(resource_type IS NOT NULL AND resource_id IS NOT NULL) AS resource_rows,
              SUM(correlation_id IS NOT NULL) AS correlation_rows,
              SUM(execution_context_json IS NOT NULL) AS context_json_rows
         FROM execution_log`
    ),
    safeRows(pool, "SELECT * FROM v_core_runtime_context_dimension_coverage ORDER BY table_name"),
    safeRows(
      pool,
      `SELECT check_name, linked_rows, fillable_tenant, fillable_user, fillable_brand, fillable_workspace
         FROM v_runtime_context_dimension_enrichment_fillable`
    ),
    safeRows(
      pool,
      `SELECT COUNT(*) AS registered_tables,
              SUM(owner_engine_key IS NULL OR owner_engine_key = '') AS owner_missing_tables,
              SUM(usage_status = 'runtime_unclassified') AS unclassified_tables,
              SUM(usage_status = 'planned_placeholder') AS placeholder_tables,
              SUM(usage_status = 'backup_snapshot') AS backup_snapshot_tables,
              SUM(risk_level = 'high') AS high_risk_tables,
              SUM(retention_class IS NULL OR retention_class = '') AS retention_class_missing_tables,
              MAX(last_checked_at) AS latest_checked_at
         FROM database_table_lifecycle_registry`
    ),
    safeRows(
      pool,
      `SELECT table_name
         FROM information_schema.views
        WHERE table_schema = DATABASE()
          AND table_name IN (${LIFECYCLE_VIEWS.map(() => "?").join(", ")})
        ORDER BY table_name`,
      LIFECYCLE_VIEWS
    ),
    safeRows(pool, "SELECT * FROM v_database_lifecycle_status_summary ORDER BY usage_status, risk_level"),
    safeRows(pool, "SELECT * FROM v_database_lifecycle_report_snapshot_summary ORDER BY report_type, engine_key"),
  ]);

  const presentExecutionLogColumns = new Set(executionLogColumns.rows.map((row) => row.column_name));
  const missingExecutionLogColumns = EXECUTION_LOG_COLUMNS.filter((column) => !presentExecutionLogColumns.has(column));
  const presentLifecycleViews = new Set(lifecycleViews.rows.map((row) => row.table_name));
  const missingLifecycleViews = LIFECYCLE_VIEWS.filter((view) => !presentLifecycleViews.has(view));
  const ledgerFiles = new Set(ledger.rows.map((row) => row.migration_file));
  const missingLedgerMigrations = MIGRATIONS.filter((migration) => !ledgerFiles.has(migration));
  const blockers = [];

  if (!ledger.ok) blockers.push("migration_ledger_read_failed");
  if (missingLedgerMigrations.length) blockers.push("migration_ledger_evidence_missing");
  if (!executionLogColumns.ok || missingExecutionLogColumns.length) blockers.push("execution_log_context_schema_incomplete");
  if (!executionLogCoverage.ok) blockers.push("execution_log_context_coverage_read_failed");
  if (!coreCoverage.ok) blockers.push("core_runtime_context_coverage_read_failed");
  if (!enrichmentCoverage.ok) blockers.push("runtime_context_enrichment_read_failed");
  if (!lifecycleRegistry.ok) blockers.push("lifecycle_registry_read_failed");
  if (!lifecycleViews.ok || missingLifecycleViews.length) blockers.push("lifecycle_reporting_views_incomplete");
  if (!lifecycleStatus.ok) blockers.push("lifecycle_status_summary_read_failed");
  if (!lifecycleSnapshots.ok) blockers.push("lifecycle_snapshot_summary_read_failed");

  const executionCoverage = executionLogCoverage.rows[0] || {};
  const lifecycleRegistryCoverage = lifecycleRegistry.rows[0] || {};
  const enrichmentChecks = enrichmentCoverage.rows.map((row) => ({
    check_name: row.check_name,
    linked_rows: numeric(row.linked_rows),
    fillable_tenant: numeric(row.fillable_tenant),
    fillable_user: numeric(row.fillable_user),
    fillable_brand: numeric(row.fillable_brand),
    fillable_workspace: numeric(row.fillable_workspace),
  }));

  return {
    ok: blockers.length === 0,
    readback_type: "platform_recomposition_live_readback_v1",
    migrations: {
      expected: MIGRATIONS,
      ledger_rows: ledger.rows,
      missing_ledger_migrations: missingLedgerMigrations,
    },
    execution_log: {
      expected_context_columns: EXECUTION_LOG_COLUMNS,
      missing_context_columns: missingExecutionLogColumns,
      coverage: {
        total_rows: numeric(executionCoverage.total_rows),
        tenant_rows: numeric(executionCoverage.tenant_rows),
        workspace_rows: numeric(executionCoverage.workspace_rows),
        user_rows: numeric(executionCoverage.user_rows),
        actor_rows: numeric(executionCoverage.actor_rows),
        brand_rows: numeric(executionCoverage.brand_rows),
        request_rows: numeric(executionCoverage.request_rows),
        session_rows: numeric(executionCoverage.session_rows),
        conversation_rows: numeric(executionCoverage.conversation_rows),
        resource_rows: numeric(executionCoverage.resource_rows),
        correlation_rows: numeric(executionCoverage.correlation_rows),
        context_json_rows: numeric(executionCoverage.context_json_rows),
      },
    },
    core_runtime_context: {
      table_count: coreCoverage.rows.length,
      tables: coreCoverage.rows.map(normalizeCoverageRow),
      enrichment_checks: enrichmentChecks,
      enrichment_fillable_dimension_count: enrichmentChecks.reduce(
        (total, row) => total + row.fillable_tenant + row.fillable_user + row.fillable_brand + row.fillable_workspace,
        0
      ),
    },
    database_lifecycle: {
      registry: {
        registered_tables: numeric(lifecycleRegistryCoverage.registered_tables),
        owner_missing_tables: numeric(lifecycleRegistryCoverage.owner_missing_tables),
        unclassified_tables: numeric(lifecycleRegistryCoverage.unclassified_tables),
        placeholder_tables: numeric(lifecycleRegistryCoverage.placeholder_tables),
        backup_snapshot_tables: numeric(lifecycleRegistryCoverage.backup_snapshot_tables),
        high_risk_tables: numeric(lifecycleRegistryCoverage.high_risk_tables),
        retention_class_missing_tables: numeric(lifecycleRegistryCoverage.retention_class_missing_tables),
        latest_checked_at: lifecycleRegistryCoverage.latest_checked_at || null,
      },
      missing_reporting_views: missingLifecycleViews,
      status_summary: lifecycleStatus.rows,
      snapshot_summary: lifecycleSnapshots.rows,
    },
    blockers,
    read_only: true,
    secrets_included: false,
  };
}

async function main() {
  const result = await runPlatformRecompositionLiveReadback();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {}
}

main()
  .then(closePoolQuietly)
  .catch(async (error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.code || error?.message || String(error),
      read_only: true,
      secrets_included: false,
    }, null, 2));
    await closePoolQuietly();
    process.exit(1);
  });
