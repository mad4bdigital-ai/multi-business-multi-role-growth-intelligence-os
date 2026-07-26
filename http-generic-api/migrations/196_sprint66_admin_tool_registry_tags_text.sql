-- Sprint 66: admin tool registry tags capacity.
-- Widen admin_platform_endpoint_tools.tags so governed metadata can store
-- complete comma-separated policy/capability tags without silent truncation.
-- This is a non-destructive widening change.

ALTER TABLE admin_platform_endpoint_tools
  MODIFY COLUMN tags TEXT NULL;

UPDATE admin_platform_endpoint_tools
   SET tags = 'admin,connected_execution,worker_bridge,resume_action,queue_enqueue,dry_run,analysis_step_only,read_only_tool_call_preflight,read_only_tool_call_execution,budgeted_tool_call,output_redaction,metadata_write,evidence_write,no_repo_mutation,no_provider_call,no_local_device_call,no_apply,no_secrets',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'connected_execution_resume_action_enqueue_dry_run';
