-- Sprint 66: Tenant SSH CLI allowlisted execute tool
-- Adds the first actual SSH CLI execution surface for tenant-owned SSH
-- connections. Execution is restricted to fixed command keys, requires an
-- approved tenant SSH CLI approval request, uses a bounded timeout/output cap,
-- and never returns credentials.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_ssh_cli_allowlisted_execute',
  'Tenant SSH CLI Allowlisted Execute',
  'Execute a fixed allowlisted SSH command for a tenant-owned SSH connection after approval. Requires approved approval_request_id and typed command_key; rejects freeform commands, rejects shell metacharacter argv drift, caps output, and never returns credentials.',
  'POST',
  '/me/infrastructure/ssh/connections/{connection_id}/cli/execute',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id','approval_request_id','command_key'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'approval_request_id',JSON_OBJECT('type','string'),
      'command_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('pwd','whoami','uname_s','uptime')),
      'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',10000,'default',5000)
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,execute,allowlisted,approval_required,typed_command_key,literal_argv,no_shell_metacharacters,no_freeform_command,no_secrets,uses_ssh_auth,opens_network,executes_command,output_capped,auth_scoped,specific_path,state_gated,file_read_permission,shell_read_permission',
  1,
  331
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
