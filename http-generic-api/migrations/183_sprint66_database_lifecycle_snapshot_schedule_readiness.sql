-- Sprint 66: database lifecycle report snapshot schedule readiness.
-- Defines reviewable schedule metadata and readiness reporting only. This
-- migration does not enable recurring execution and does not archive, delete,
-- drop, truncate, compact, or read secrets.

CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshot_schedules (
  schedule_key VARCHAR(128) PRIMARY KEY,
  report_type VARCHAR(96) NOT NULL DEFAULT 'retention_plan',
  engine_key VARCHAR(128) NOT NULL DEFAULT 'database_table_lifecycle_engine',
  cron_expression VARCHAR(64) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  report_limit INT NOT NULL DEFAULT 80,
  snapshot_retention_days INT NOT NULL DEFAULT 180,
  notification_target VARCHAR(191) NULL,
  approval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by VARCHAR(191) NULL,
  approved_at TIMESTAMP NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'planned_disabled',
  executor_policy_key VARCHAR(128) NULL,
  last_readiness_at TIMESTAMP NULL,
  last_snapshot_id VARCHAR(64) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_db_lifecycle_snapshot_schedule_status (status, approval_status),
  KEY idx_db_lifecycle_snapshot_schedule_report (report_type, engine_key)
);

INSERT INTO database_lifecycle_report_snapshot_schedules
  (schedule_key, report_type, engine_key, cron_expression, timezone, report_limit,
   snapshot_retention_days, notification_target, approval_status, status,
   executor_policy_key, notes)
VALUES
  (
    'database_lifecycle_retention_plan_weekly',
    'retention_plan',
    'database_table_lifecycle_engine',
    '0 3 * * 1',
    'UTC',
    80,
    180,
    NULL,
    'pending',
    'planned_disabled',
    'database_lifecycle_report_snapshot_schedule_policy_v1',
    'Planned weekly evidence snapshot schedule. Disabled until admin approval defines notification target and scheduler binding.'
  )
ON DUPLICATE KEY UPDATE
  report_type = VALUES(report_type),
  engine_key = VALUES(engine_key),
  cron_expression = VALUES(cron_expression),
  timezone = VALUES(timezone),
  report_limit = VALUES(report_limit),
  snapshot_retention_days = VALUES(snapshot_retention_days),
  executor_policy_key = VALUES(executor_policy_key),
  notes = VALUES(notes);

CREATE OR REPLACE VIEW v_database_lifecycle_report_snapshot_schedule_readiness AS
SELECT
  schedule_key,
  report_type,
  engine_key,
  cron_expression,
  timezone,
  report_limit,
  snapshot_retention_days,
  notification_target,
  approval_status,
  status,
  CASE
    WHEN status = 'active'
     AND approval_status = 'approved'
     AND notification_target IS NOT NULL
     AND executor_policy_key IS NOT NULL
    THEN 1 ELSE 0
  END AS scheduler_ready,
  executor_policy_key,
  last_readiness_at,
  last_snapshot_id,
  updated_at
FROM database_lifecycle_report_snapshot_schedules;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, method, path, path_params_json, input_schema_json, output_schema_json, tags, is_active, sort_order)
VALUES
  (
    'database_lifecycle_report_snapshot_schedules',
    'Database Lifecycle Report Snapshot Schedules',
    'List planned database lifecycle report snapshot schedules. Read-only; does not run scheduler jobs or lifecycle cleanup.',
    'GET',
    '/platform/engines/database-lifecycle/report-snapshot-schedules',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'report_type',JSON_OBJECT('type','string'),
        'status',JSON_OBJECT('type','string'),
        'limit',JSON_OBJECT('type','integer')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,schedule_readiness,read_only,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4312
  ),
  (
    'database_lifecycle_report_snapshot_schedule_readiness',
    'Database Lifecycle Report Snapshot Schedule Readiness',
    'Assess whether lifecycle report snapshot schedules have approval, notification, and executor-policy metadata. Read-only; does not execute scheduled work.',
    'POST',
    '/platform/engines/database-lifecycle/report-snapshot-schedule-readiness',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'schedule_key',JSON_OBJECT('type','string'),
        'report_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('retention_plan')),
        'limit',JSON_OBJECT('type','integer')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,schedule_readiness,read_only,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4313
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
       'read_only',
       0,
       JSON_ARRAY('admin'),
       JSON_OBJECT('schedule_readiness_only', true, 'no_drop', true, 'no_delete', true, 'no_archive_execution', true, 'no_secret_read', true, 'will_execute', false),
       'active'
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('database_lifecycle_report_snapshot_schedules', 'database_lifecycle_report_snapshot_schedule_readiness')
ON DUPLICATE KEY UPDATE
  risk_class = VALUES(risk_class),
  approval_required = VALUES(approval_required),
  allowed_roles_json = VALUES(allowed_roles_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status);
