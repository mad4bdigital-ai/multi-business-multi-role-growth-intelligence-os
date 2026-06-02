-- Sprint 66: database lifecycle scheduler approval readback.
-- Registers a read-only verification surface for scheduler approval metadata.
-- This does not enable scheduler jobs, enqueue work, write snapshots, archive,
-- delete, drop, truncate, compact, or read secrets.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, method, path, path_params_json, input_schema_json, output_schema_json, tags, is_active, sort_order)
VALUES
  (
    'database_lifecycle_scheduler_approval_readback',
    'Database Lifecycle Scheduler Approval Readback',
    'Verify scheduler schedule/binding approval metadata and its audit event after confirmation-gated metadata apply. Read-only; does not run scheduler jobs or lifecycle cleanup.',
    'POST',
    '/platform/engines/database-lifecycle/scheduler-approval-readback',
    NULL,
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_type','target_key'),
      'properties',JSON_OBJECT(
        'target_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('schedule','binding')),
        'target_key',JSON_OBJECT('type','string'),
        'event_id',JSON_OBJECT('type','string'),
        'event_key',JSON_OBJECT('type','string')
      )
    ),
    NULL,
    'platform_engine,database_lifecycle,scheduler_approval,readback,read_only,no_drop,no_delete,no_archive_execution,no_secret_read,admin',
    1,
    4317
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
       JSON_OBJECT('readback_only', true, 'will_execute', false, 'no_drop', true, 'no_delete', true, 'no_archive_execution', true, 'no_secret_read', true),
       'active'
FROM admin_platform_endpoint_tools
WHERE tool_key = 'database_lifecycle_scheduler_approval_readback'
ON DUPLICATE KEY UPDATE
  risk_class = VALUES(risk_class),
  approval_required = VALUES(approval_required),
  allowed_roles_json = VALUES(allowed_roles_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status);
