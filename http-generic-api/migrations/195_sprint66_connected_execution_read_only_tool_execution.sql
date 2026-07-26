-- Sprint 66: connected execution read-only tool_call execution.
-- Extends read-only tool_call preflight into opt-in read-only execution for
-- allowlisted GET tools only. Execution requires both action payload and
-- guardrail opt-in, uses one tool call per action, redacts/truncates output,
-- and still forbids repo mutation, provider calls, local-device calls, apply
-- operations, and secret exposure.

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  (
    'connected_execution_worker_bridge_v3_read_only_tool_execution',
    'connected_execution_worker_bridge',
    'execution_continuity',
    'connected_execution_resume_action_enqueue_dry_run',
    'B',
    'read_only_tool_execution_registered',
    'enqueue_allowlisted_read_only_tool_call_execution_and_read_redacted_evidence',
    1,
    0,
    1,
    1,
    1,
    1,
    'Allows opt-in execution of allowlisted GET-only read-only tool_call actions. Requires action_payload.execute_read_only_tool_call=true and guardrails.allow_read_only_tool_execution=true. One tool call per action, output redaction/truncation, no apply/repo/provider/local-device writes.'
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

UPDATE admin_platform_endpoint_tools
   SET description = 'Enqueue one connected execution resume action for worker bridge processing. Supports analysis_step metadata-only actions, tool_call read-only preflight/evidence, and opt-in read-only execution for allowlisted GET tools. No repo mutation, provider call, local-device call, apply operation, or secret exposure is allowed.',
       tags = 'admin,connected_execution,worker_bridge,resume_action,queue_enqueue,dry_run,analysis_step_only,read_only_tool_call_preflight,read_only_tool_call_execution,budgeted_tool_call,output_redaction,metadata_write,evidence_write,no_repo_mutation,no_provider_call,no_local_device_call,no_apply,no_secrets',
       fixed_body = '{"dry_run":true,"max_attempts":1,"read_only_tool_call_preflight":true,"read_only_tool_call_execution":true}',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'connected_execution_resume_action_enqueue_dry_run';
