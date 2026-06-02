-- Sprint 66: database lifecycle scheduler approval metadata.
-- Adds confirmation-gated metadata updates for lifecycle snapshot schedules and
-- scheduler bindings. This does not enable a scheduler, enqueue jobs, write
-- snapshots, archive, delete, drop, truncate, compact, or read secrets.

CREATE TABLE IF NOT EXISTS database_lifecycle_scheduler_approval_events (
  event_id VARCHAR(64) PRIMARY KEY,
  event_key VARCHAR(191) NOT NULL UNIQUE,
  target_type VARCHAR(32) NOT NULL,
  target_key VARCHAR(128) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  previous_status VARCHAR(32) NULL,
  previous_approval_status VARCHAR(32) NULL,
  next_status VARCHAR(32) NOT NULL,
  next_approval_status VARCHAR(32) NOT NULL,
  notification_target VARCHAR(191) NULL,
  executor_policy_key VARCHAR(128) NULL,
  actor_id VARCHAR(191) NULL,
  trace_id VARCHAR(191) NULL,
  reason TEXT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 0,
  will_execute TINYINT(1) NOT NULL DEFAULT 0,
  no_drop TINYINT(1) NOT NULL DEFAULT 1,
  no_delete TINYINT(1) NOT NULL DEFAULT 1,
  no_archive_execution TINYINT(1) NOT NULL DEFAULT 1,
  no_compaction_execution TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_db_lifecycle_scheduler_approval_target (target_type, target_key, created_at),
  KEY idx_db_lifecycle_scheduler_approval_decision (decision, created_at)
);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'database_lifecycle_scheduler_approval_metadata',
    'Database Lifecycle Scheduler Approval Metadata',
    'Plan or apply confirmation-gated scheduler schedule/binding metadata approval. Does not enable scheduler jobs or lifecycle cleanup.',
    'POST',
    '/platform/engines/database-lifecycle/scheduler-approval-metadata',
    NULL,
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_type','target_key','decision'),
      'properties',JSON_OBJECT(
        'target_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('schedule','binding')),
        'target_key',JSON_OBJECT('type','string'),
        'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve','reject','revoke')),
        'notification_target',JSON_OBJECT('type','string'),
        'executor_policy_key',JSON_OBJECT('type','string'),
        'actor_id',JSON_OBJECT('type','string'),
        'trace_id',JSON_OBJECT('type','string'),
        'reason',JSON_OBJECT('type','string'),
        'apply',JSON_OBJECT('type','boolean'),
        'confirm',JSON_OBJECT('type','string')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,scheduler_approval,metadata_write,confirmation_required,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4316
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
       'admin_registry_write',
       1,
       JSON_ARRAY('admin'),
       JSON_OBJECT('metadata_only', true, 'typed_confirmation_required', true, 'will_execute', false, 'no_drop', true, 'no_delete', true, 'no_archive_execution', true, 'no_secret_read', true),
       'active'
FROM admin_platform_endpoint_tools
WHERE tool_key = 'database_lifecycle_scheduler_approval_metadata'
ON DUPLICATE KEY UPDATE
  risk_class = VALUES(risk_class),
  approval_required = VALUES(approval_required),
  allowed_roles_json = VALUES(allowed_roles_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status);
