-- Sprint 66: Tenant infrastructure readiness tools
-- Adds tenant-facing read-only/status and dry-run preflight tools for
-- user-owned remote database and SSH connections. These tools never return
-- secrets, never execute SSH commands, and never query remote databases.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'tenant_database_connection_status',
  'Tenant Database Connection Status',
  'Read tenant-scoped readiness/status for a user-owned remote database connection. Does not decrypt credentials or query the database.',
  'GET',
  '/me/infrastructure/connections/{connection_id}/status',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT('type','object','required',JSON_ARRAY('connection_id'),'properties',JSON_OBJECT('connection_id',JSON_OBJECT('type','string'),'auth_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('remote_database'),'default','remote_database')),'additionalProperties',false),
  JSON_OBJECT('auth_type','remote_database'),
  'tenant,infrastructure,database,status,read_only,no_secrets,no_network,no_query,auth_scoped',
  1,
  320
),
(
  'tenant_database_preflight',
  'Tenant Database Preflight',
  'Dry-run readiness preflight for a user-owned remote database connection. Does not decrypt credentials or open a database connection.',
  'POST',
  '/me/infrastructure/connections/{connection_id}/preflight',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT('type','object','required',JSON_ARRAY('connection_id'),'properties',JSON_OBJECT('connection_id',JSON_OBJECT('type','string'),'auth_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('remote_database'),'default','remote_database')),'additionalProperties',false),
  JSON_OBJECT('auth_type','remote_database'),
  'tenant,infrastructure,database,preflight,dry_run,read_only,no_secrets,no_network,no_query,auth_scoped',
  1,
  321
),
(
  'tenant_ssh_connection_status',
  'Tenant SSH Connection Status',
  'Read tenant-scoped readiness/status for a user-owned SSH connection. Does not decrypt credentials or execute commands.',
  'GET',
  '/me/infrastructure/connections/{connection_id}/status',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT('type','object','required',JSON_ARRAY('connection_id'),'properties',JSON_OBJECT('connection_id',JSON_OBJECT('type','string'),'auth_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('ssh_key_pair'),'default','ssh_key_pair')),'additionalProperties',false),
  JSON_OBJECT('auth_type','ssh_key_pair'),
  'tenant,infrastructure,ssh,status,read_only,no_secrets,no_command,no_network,auth_scoped',
  1,
  322
),
(
  'tenant_ssh_preflight',
  'Tenant SSH Preflight',
  'Dry-run readiness preflight for a user-owned SSH connection. Does not decrypt credentials or execute commands.',
  'POST',
  '/me/infrastructure/connections/{connection_id}/preflight',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT('type','object','required',JSON_ARRAY('connection_id'),'properties',JSON_OBJECT('connection_id',JSON_OBJECT('type','string'),'auth_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('ssh_key_pair'),'default','ssh_key_pair')),'additionalProperties',false),
  JSON_OBJECT('auth_type','ssh_key_pair'),
  'tenant,infrastructure,ssh,preflight,dry_run,read_only,no_secrets,no_command,no_network,auth_scoped',
  1,
  323
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
