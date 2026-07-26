-- Sprint 66: database lifecycle scheduler approval readback.
-- Registers a read-only verification surface for scheduler approval metadata.
-- This does not enable scheduler jobs, enqueue work, write snapshots, archive,
-- delete, drop, truncate, compact, or read secrets.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
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
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

-- Policy metadata for this readback tool is carried through the admin tool tags and governed runtime registry surfaces.
