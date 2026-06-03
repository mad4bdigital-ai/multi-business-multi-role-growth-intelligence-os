-- Sprint 66: database lifecycle scheduler snapshot queue tools.
-- Registers dry-run-only governed admin tools for the scheduler snapshot direct runner
-- and queue enqueue surfaces. These rows do not enable apply execution from GPT tools.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'database_lifecycle_scheduler_snapshot_runner_dry_run',
    'Database Lifecycle Scheduler Snapshot Runner Dry Run',
    'Run the governed database lifecycle scheduler snapshot runner in dry-run mode only. Does not write snapshots, archive, delete, drop, truncate, compact, or read secrets.',
    'POST',
    '/platform/engines/database-lifecycle/scheduler-snapshot-runner',
    '[]',
    '{"type":"object","additionalProperties":false,"properties":{"actor_id":{"type":"string"},"binding_key":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":1000},"notes":{"type":"string","maxLength":1000},"schedule_key":{"type":"string"},"summary_only":{"type":"boolean","default":true},"tenant_id":{"type":"string"},"trace_id":{"type":"string"},"apply":{"type":"boolean","enum":[false],"default":false}}}',
    '{"apply":false,"summary_only":true}',
    'admin,platform_engine,database_lifecycle,scheduler_snapshot,dry_run,readiness,no_drop,no_delete,no_archive_execution,no_compaction_execution,no_secret_read,no_queue_write',
    1,
    4318
  ),
  (
    'database_lifecycle_scheduler_snapshot_job_enqueue_dry_run',
    'Database Lifecycle Scheduler Snapshot Job Enqueue Dry Run',
    'Enqueue a governed database lifecycle scheduler snapshot job with apply=false only. Writes job metadata to Redis/BullMQ, but the job payload remains dry-run and must not write snapshots or perform lifecycle cleanup.',
    'POST',
    '/platform/engines/database-lifecycle/scheduler-snapshot-jobs',
    '[]',
    '{"type":"object","additionalProperties":false,"properties":{"actor_id":{"type":"string"},"binding_key":{"type":"string"},"idempotency_key":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":1000},"max_attempts":{"type":"integer","minimum":1,"maximum":3,"default":1},"notes":{"type":"string","maxLength":1000},"requested_by":{"type":"string"},"schedule_key":{"type":"string"},"summary_only":{"type":"boolean","default":true},"tenant_id":{"type":"string"},"trace_id":{"type":"string"},"webhook_url":{"type":"string"},"apply":{"type":"boolean","enum":[false],"default":false}}}',
    '{"apply":false,"summary_only":true,"max_attempts":1}',
    'admin,platform_engine,database_lifecycle,scheduler_snapshot,queue_enqueue,dry_run,redis_write,no_drop,no_delete,no_archive_execution,no_compaction_execution,no_secret_read,no_apply',
    1,
    4319
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  (
    'database_lifecycle_scheduler_snapshot_queue_tools_v1',
    'database_lifecycle_scheduler_snapshot',
    'database_lifecycle',
    'database_lifecycle_scheduler_snapshot_job_enqueue_dry_run',
    'B',
    'dry_run_queue_registered',
    'enqueue_apply_false_snapshot_job_and_read_queue_health',
    1,
    0,
    0,
    1,
    1,
    1,
    'Dry-run-only direct runner and Redis/BullMQ enqueue tools for database lifecycle scheduler snapshots. GPT tool registration does not allow apply=true.'
  )
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  notes = VALUES(notes);
