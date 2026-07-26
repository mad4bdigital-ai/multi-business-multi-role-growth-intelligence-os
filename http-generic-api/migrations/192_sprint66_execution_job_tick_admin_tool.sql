-- Sprint 66: guarded execution job tick admin tool.
-- Adds an admin-only manual tick route for one queued job. This is intended
-- as a recovery/smoke aid when BullMQ enqueue succeeds but the worker has not
-- picked up a job yet. The route uses the same executeSingleQueuedJob runner.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'execution_job_tick_admin',
    'Execution Job Tick Admin',
    'Admin-only recovery/smoke helper that processes exactly one queued job through the existing executeSingleQueuedJob runner. It does not create jobs, change queue configuration, or grant new execution capability.',
    'POST',
    '/jobs/{job_id}/tick',
    '["job_id"]',
    '{"type":"object","additionalProperties":false,"required":["job_id"],"properties":{"job_id":{"type":"string","minLength":1}}}',
    NULL,
    'admin,jobs,worker_tick,recovery,smoke,state_changing,one_job_only,requires_queued_status,no_secret_read,no_new_capability',
    1,
    4405
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
    'execution_job_tick_admin_v1',
    'execution_job_tick_admin',
    'job_runtime_recovery',
    'execution_job_tick_admin',
    'B',
    'manual_tick_registered',
    'tick_one_queued_job_and_read_status_evidence',
    1,
    0,
    1,
    0,
    1,
    1,
    'Admin-only one-job tick recovery surface. Requires existing queued job and uses the same executeSingleQueuedJob runner path as BullMQ worker processing.'
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
