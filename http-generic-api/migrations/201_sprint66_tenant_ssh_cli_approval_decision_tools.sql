-- Sprint 66: Tenant SSH CLI approval status and decision tools
-- Adds tenant-scoped readback and workspace-owner decision tools for SSH CLI
-- approval requests. These tools update approval state only; they do not enable
-- SSH command execution and never return secrets.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'tenant_ssh_cli_approval_request_status',
  'Tenant SSH CLI Approval Request Status',
  'Read a tenant-scoped SSH CLI approval request and linked approval hold status. Does not execute commands or return credentials.',
  'GET',
  '/me/infrastructure/ssh/cli/approval-requests/{request_id}',
  JSON_ARRAY('request_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('request_id'),
    'properties',JSON_OBJECT('request_id',JSON_OBJECT('type','string')),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,approval_status,read_only,no_secrets,no_auth,no_network,no_command,no_execute,auth_scoped,specific_path',
  1,
  329
),
(
  'tenant_ssh_cli_approval_request_decide',
  'Tenant SSH CLI Approval Request Decide',
  'Approve or reject a tenant-scoped SSH CLI approval request as a workspace owner. Updates approval state only and does not enable or execute SSH commands.',
  'POST',
  '/me/infrastructure/ssh/cli/approval-requests/{request_id}/decision',
  JSON_ARRAY('request_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('request_id','decision'),
    'properties',JSON_OBJECT(
      'request_id',JSON_OBJECT('type','string'),
      'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approved','rejected')),
      'decision_note',JSON_OBJECT('type','string','maxLength',512)
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,approval_decision,workspace_owner_required,no_secrets,no_auth,no_network,no_command,no_execute,auth_scoped,specific_path,state_changing',
  1,
  330
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
