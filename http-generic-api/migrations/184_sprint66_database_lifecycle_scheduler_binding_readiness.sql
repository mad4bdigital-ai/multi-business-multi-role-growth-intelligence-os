-- Sprint 66: database lifecycle scheduler binding readiness.
-- Records planned scheduler bindings and exposes readiness metadata only. This
-- migration does not enable a scheduler, enqueue jobs, write snapshots, archive,
-- delete, drop, truncate, compact, or read secrets.

CREATE TABLE IF NOT EXISTS database_lifecycle_report_snapshot_scheduler_bindings (
  binding_key VARCHAR(128) PRIMARY KEY,
  schedule_key VARCHAR(128) NOT NULL,
  runner_key VARCHAR(128) NOT NULL DEFAULT 'database_lifecycle_report_snapshot_runner',
  runner_command VARCHAR(512) NOT NULL,
  scheduler_surface VARCHAR(96) NOT NULL DEFAULT 'external_scheduler',
  executor_policy_key VARCHAR(128) NOT NULL,
  notification_target VARCHAR(191) NULL,
  approval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by VARCHAR(191) NULL,
  approved_at TIMESTAMP NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'planned_disabled',
  dry_run_required TINYINT(1) NOT NULL DEFAULT 1,
  confirmation_required TINYINT(1) NOT NULL DEFAULT 1,
  readback_required TINYINT(1) NOT NULL DEFAULT 1,
  will_execute TINYINT(1) NOT NULL DEFAULT 0,
  no_drop TINYINT(1) NOT NULL DEFAULT 1,
  no_delete TINYINT(1) NOT NULL DEFAULT 1,
  no_archive_execution TINYINT(1) NOT NULL DEFAULT 1,
  no_compaction_execution TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_db_lifecycle_scheduler_binding_schedule (schedule_key, status),
  KEY idx_db_lifecycle_scheduler_binding_approval (approval_status, status)
);

INSERT INTO database_lifecycle_report_snapshot_scheduler_bindings
  (binding_key, schedule_key, runner_key, runner_command, scheduler_surface,
   executor_policy_key, notification_target, approval_status, status,
   dry_run_required, confirmation_required, readback_required, will_execute,
   no_drop, no_delete, no_archive_execution, no_compaction_execution,
   secrets_included, notes)
VALUES
  (
    'database_lifecycle_retention_plan_weekly_binding',
    'database_lifecycle_retention_plan_weekly',
    'database_lifecycle_report_snapshot_runner',
    'node scripts/database-lifecycle-report-snapshot.mjs --report-type retention_plan --limit 80 --apply --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT',
    'external_scheduler',
    'database_lifecycle_report_snapshot_schedule_policy_v1',
    NULL,
    'pending',
    'planned_disabled',
    1,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    0,
    'Planned scheduler binding only. Disabled until admin approval defines notification target, scheduler identity, and readback evidence.'
  )
ON DUPLICATE KEY UPDATE
  schedule_key = VALUES(schedule_key),
  runner_key = VALUES(runner_key),
  runner_command = VALUES(runner_command),
  scheduler_surface = VALUES(scheduler_surface),
  executor_policy_key = VALUES(executor_policy_key),
  dry_run_required = VALUES(dry_run_required),
  confirmation_required = VALUES(confirmation_required),
  readback_required = VALUES(readback_required),
  will_execute = VALUES(will_execute),
  no_drop = VALUES(no_drop),
  no_delete = VALUES(no_delete),
  no_archive_execution = VALUES(no_archive_execution),
  no_compaction_execution = VALUES(no_compaction_execution),
  secrets_included = VALUES(secrets_included),
  notes = VALUES(notes);

CREATE OR REPLACE VIEW v_database_lifecycle_scheduler_binding_readiness AS
SELECT
  b.binding_key,
  b.schedule_key,
  s.report_type,
  s.cron_expression,
  s.timezone,
  b.runner_key,
  b.scheduler_surface,
  b.executor_policy_key,
  b.notification_target,
  b.approval_status,
  b.status,
  CASE
    WHEN b.status = 'active'
     AND b.approval_status = 'approved'
     AND s.status = 'active'
     AND s.approval_status = 'approved'
     AND b.notification_target IS NOT NULL
     AND b.executor_policy_key IS NOT NULL
     AND b.confirmation_required = 1
     AND b.readback_required = 1
     AND b.will_execute = 0
    THEN 1 ELSE 0
  END AS binding_ready,
  b.dry_run_required,
  b.confirmation_required,
  b.readback_required,
  b.will_execute,
  b.no_drop,
  b.no_delete,
  b.no_archive_execution,
  b.no_compaction_execution,
  b.secrets_included,
  b.updated_at
FROM database_lifecycle_report_snapshot_scheduler_bindings b
LEFT JOIN database_lifecycle_report_snapshot_schedules s
  ON s.schedule_key = b.schedule_key;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'database_lifecycle_scheduler_bindings',
    'Database Lifecycle Scheduler Bindings',
    'List planned lifecycle snapshot scheduler bindings. Read-only; does not enable or run scheduler work.',
    'GET',
    '/platform/engines/database-lifecycle/scheduler-bindings',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'schedule_key',JSON_OBJECT('type','string'),
        'status',JSON_OBJECT('type','string'),
        'limit',JSON_OBJECT('type','integer')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,scheduler_binding,read_only,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4314
  ),
  (
    'database_lifecycle_scheduler_binding_readiness',
    'Database Lifecycle Scheduler Binding Readiness',
    'Assess planned lifecycle snapshot scheduler bindings. Read-only; does not enable scheduler work or execute snapshots.',
    'POST',
    '/platform/engines/database-lifecycle/scheduler-binding-readiness',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'binding_key',JSON_OBJECT('type','string'),
        'schedule_key',JSON_OBJECT('type','string'),
        'limit',JSON_OBJECT('type','integer')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,scheduler_binding,read_only,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4315
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
       JSON_OBJECT('scheduler_binding_readiness_only', true, 'will_execute', false, 'no_drop', true, 'no_delete', true, 'no_archive_execution', true, 'no_secret_read', true),
       'active'
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('database_lifecycle_scheduler_bindings', 'database_lifecycle_scheduler_binding_readiness')
ON DUPLICATE KEY UPDATE
  risk_class = VALUES(risk_class),
  approval_required = VALUES(approval_required),
  allowed_roles_json = VALUES(allowed_roles_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status);
