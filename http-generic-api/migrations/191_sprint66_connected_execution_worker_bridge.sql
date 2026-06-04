-- Sprint 66: connected execution worker bridge.
-- Registers a dry-run-only enqueue surface for analysis_step resume actions.
-- The worker bridge writes metadata/evidence only and does not execute tools,
-- repo operations, DB operations, provider calls, or local-device calls.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'connected_execution_resume_action_enqueue_dry_run',
    'Connected Execution Resume Action Enqueue Dry Run',
    'Enqueue one connected execution resume action for metadata-only worker processing. Only analysis_step is accepted; no external tool, repo, DB, provider, or local-device execution is allowed.',
    'POST',
    '/connected-execution/sessions/{connected_session_id}/resume-actions/{resume_action_id}/enqueue',
    '["connected_session_id","resume_action_id"]',
    '{"type":"object","additionalProperties":false,"required":["connected_session_id","resume_action_id"],"properties":{"connected_session_id":{"type":"string","minLength":1},"resume_action_id":{"type":"string","minLength":1},"requested_by":{"type":"string"},"idempotency_key":{"type":"string"},"trace_id":{"type":"string"}}}',
    '{"dry_run":true,"max_attempts":1}',
    'admin,connected_execution,worker_bridge,resume_action,queue_enqueue,dry_run,analysis_step_only,metadata_write,evidence_write,no_tool_execution,no_repo_mutation,no_provider_call,no_local_device_call,no_secrets',
    1,
    4404
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
    'connected_execution_worker_bridge_v1',
    'connected_execution_worker_bridge',
    'execution_continuity',
    'connected_execution_resume_action_enqueue_dry_run',
    'B',
    'analysis_step_worker_registered',
    'enqueue_analysis_step_resume_action_and_read_evidence_report',
    1,
    0,
    0,
    1,
    1,
    1,
    'Dry-run-only connected execution worker bridge for analysis_step resume actions. It writes metadata/evidence only and does not execute external tools or apply operations.'
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
  requires_readback = VALUES(readback),
  notes = VALUES(notes);
