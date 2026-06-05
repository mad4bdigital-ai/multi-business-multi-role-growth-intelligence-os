-- Sprint 66: connected execution read-only tool_call preflight.
-- Extends the connected execution worker bridge from analysis_step metadata-only
-- actions to read-only tool_call preflight/evidence. This migration updates
-- registry descriptions and registers a v2 certification. It does not enable
-- tool execution, apply operations, repo mutation, provider calls, local-device
-- calls, or secret exposure.
--
-- Safe additive repair note: this migration updates admin_platform_endpoint_tools.updated_at.
-- The column is useful audit metadata, so create it when absent instead of omitting
-- the canonical registry timestamp update.

ALTER TABLE `admin_platform_endpoint_tools`
  ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  (
    'connected_execution_worker_bridge_v2_read_only_tool_call_preflight',
    'connected_execution_worker_bridge',
    'execution_continuity',
    'connected_execution_resume_action_enqueue_dry_run',
    'B',
    'read_only_tool_call_preflight_registered',
    'enqueue_allowlisted_tool_call_preflight_and_read_evidence_report',
    1,
    0,
    1,
    1,
    1,
    1,
    'Extends the worker bridge to allow tool_call actions only as read-only preflight/evidence for a hardcoded allowlist. The worker does not execute tools and records tool_call_executed=false.'
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
   SET description = 'Enqueue one connected execution resume action for worker bridge processing. Supports analysis_step metadata-only actions and tool_call read-only preflight/evidence for the allowlisted phase. No external tool execution, repo mutation, provider call, local-device call, apply operation, or secret exposure is allowed.',
       tags = 'admin,connected_execution,worker_bridge,resume_action,queue_enqueue,dry_run,analysis_step_only,read_only_tool_call_preflight,metadata_write,evidence_write,no_tool_execution,no_repo_mutation,no_provider_call,no_local_device_call,no_secrets',
       fixed_body = '{"dry_run":true,"max_attempts":1,"read_only_tool_call_preflight":true}'
 WHERE tool_key = 'connected_execution_resume_action_enqueue_dry_run';
