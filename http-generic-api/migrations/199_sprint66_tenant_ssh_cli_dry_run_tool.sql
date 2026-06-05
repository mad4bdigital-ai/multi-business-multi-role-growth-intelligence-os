-- Sprint 66: Tenant SSH allowlisted CLI dry-run tool
-- Adds a tenant-facing dry-run planner for future SSH CLI execution. This tool
-- validates a command_key against a fixed allowlist and returns a plan only.
-- It does not decrypt credentials, does not authenticate, does not open a
-- network connection, does not execute commands, and never returns secrets.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_ssh_cli_allowlisted_dry_run',
  'Tenant SSH CLI Allowlisted Dry-run',
  'Validate a tenant-owned SSH connection and build a dry-run plan for a fixed allowlisted command key. Does not authenticate, open SSH, execute commands, or return credentials.',
  'POST',
  '/me/infrastructure/ssh/connections/{connection_id}/cli/dry-run',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id','command_key'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'command_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('pwd','whoami','uname_s','uptime'))
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,dry_run,allowlisted,read_only,no_secrets,no_auth,no_network,no_command,no_freeform_command,auth_scoped,specific_path',
  1,
  327
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
