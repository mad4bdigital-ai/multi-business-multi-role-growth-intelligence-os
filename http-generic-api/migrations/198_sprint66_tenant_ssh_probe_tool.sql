-- Sprint 66: Tenant SSH TCP/banner probe tool
-- Adds a tenant-facing SSH probe for user-owned SSH connections. This probe
-- performs TCP reachability and SSH banner detection only. It does not
-- authenticate, does not execute commands, does not use the private key for
-- auth, blocks private/local probe targets, and never returns secrets.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_ssh_probe',
  'Tenant SSH Probe',
  'Probe a tenant-owned SSH connection with a TCP/banner check only. Does not authenticate, execute commands, or return credentials. Blocks private/local probe targets.',
  'POST',
  '/me/infrastructure/ssh/connections/{connection_id}/probe',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',10000,'default',5000)
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,probe,tcp_banner,read_only,no_secrets,no_auth,no_command,no_private_network,auth_scoped,specific_path',
  1,
  326
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
