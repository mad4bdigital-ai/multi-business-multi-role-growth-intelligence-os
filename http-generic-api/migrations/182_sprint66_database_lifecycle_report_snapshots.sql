-- Sprint 66: database lifecycle report snapshot foundation.
-- Evidence-only lifecycle report snapshots. No archive, delete, drop, truncate,
-- compaction, credential read, or table cleanup execution is introduced here.

CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshots (
  snapshot_id VARCHAR(64) PRIMARY KEY,
  snapshot_key VARCHAR(191) NOT NULL UNIQUE,
  report_type VARCHAR(96) NOT NULL,
  engine_key VARCHAR(128) NOT NULL DEFAULT 'database_table_lifecycle_engine',
  source_plan_type VARCHAR(128) NULL,
  table_count INT NOT NULL DEFAULT 0,
  approval_required_count INT NOT NULL DEFAULT 0,
  high_risk_count INT NOT NULL DEFAULT 0,
  archive_candidate_count INT NOT NULL DEFAULT 0,
  summary_json JSON NULL,
  report_json JSON NOT NULL,
  source_options_json JSON NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  will_execute TINYINT(1) NOT NULL DEFAULT 0,
  no_drop TINYINT(1) NOT NULL DEFAULT 1,
  no_delete TINYINT(1) NOT NULL DEFAULT 1,
  no_archive_execution TINYINT(1) NOT NULL DEFAULT 1,
  no_compaction_execution TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  actor_id VARCHAR(191) NULL,
  trace_id VARCHAR(191) NULL,
  tenant_id VARCHAR(191) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_db_lifecycle_report_type_created (report_type, created_at),
  KEY idx_db_lifecycle_engine_created (engine_key, created_at),
  KEY idx_db_lifecycle_high_risk (high_risk_count, approval_required_count)
);

CREATE OR REPLACE VIEW v_database_lifecycle_report_snapshot_summary AS
SELECT
  report_type,
  engine_key,
  COUNT(*) AS snapshot_count,
  MAX(created_at) AS latest_snapshot_at,
  SUM(table_count) AS total_tables_observed,
  SUM(approval_required_count) AS total_approval_required_rows,
  SUM(high_risk_count) AS total_high_risk_rows,
  SUM(archive_candidate_count) AS total_archive_candidate_rows
FROM database_lifecycle_report_snapshots
GROUP BY report_type, engine_key;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, method, path, path_params_json, input_schema_json, output_schema_json, tags, is_active, sort_order)
VALUES
  (
    'database_lifecycle_report_snapshot_create',
    'Database Lifecycle Report Snapshot Create',
    'Create an evidence-only snapshot of a database lifecycle report. Confirmation-gated; does not archive, delete, drop, truncate, compact, or read secrets.',
    'POST',
    '/platform/engines/database-lifecycle/report-snapshots',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'report_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('retention_plan','lifecycle_census','registry_upsert_plan')),
        'limit',JSON_OBJECT('type','integer'),
        'apply',JSON_OBJECT('type','boolean'),
        'confirm',JSON_OBJECT('type','string'),
        'actor_id',JSON_OBJECT('type','string'),
        'trace_id',JSON_OBJECT('type','string'),
        'tenant_id',JSON_OBJECT('type','string'),
        'notes',JSON_OBJECT('type','string')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,report_snapshot,evidence_write,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4310
  ),
  (
    'database_lifecycle_report_snapshots',
    'Database Lifecycle Report Snapshots',
    'List evidence-only database lifecycle report snapshots. Read-only; does not execute lifecycle cleanup.',
    'GET',
    '/platform/engines/database-lifecycle/report-snapshots',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'report_type',JSON_OBJECT('type','string'),
        'limit',JSON_OBJECT('type','integer')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,report_snapshot,read_only,no_drop,no_delete,no_archive_execution,admin',
    1,
    4311
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  method = VALUES(method),
  path = VALUES(path),
  input_schema_json = VALUES(input_schema_json),
  tags = VALUES(tags),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

INSERT INTO tool_policy_registry (tool_key, policy_key, risk_class, approval_required, allowed_roles_json, metadata_json, status)
SELECT tool_key,
       CONCAT(tool_key, '_policy_v1'),
       CASE WHEN tool_key = 'database_lifecycle_report_snapshot_create' THEN 'admin_registry_write' ELSE 'read_only' END AS risk_class,
       CASE WHEN tool_key = 'database_lifecycle_report_snapshot_create' THEN 1 ELSE 0 END AS approval_required,
       JSON_ARRAY('admin'),
       JSON_OBJECT('evidence_only', true, 'no_drop', true, 'no_delete', true, 'no_archive_execution', true, 'no_secret_read', true),
       'active'
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('database_lifecycle_report_snapshot_create', 'database_lifecycle_report_snapshots')
ON DUPLICATE KEY UPDATE
  risk_class = VALUES(risk_class),
  approval_required = VALUES(approval_required),
  allowed_roles_json = VALUES(allowed_roles_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status);
