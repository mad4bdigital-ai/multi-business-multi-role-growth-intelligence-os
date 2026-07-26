-- Sprint 66: Tenant remote database schema read tool
-- Adds a tenant-facing read-only schema inspection tool for user-owned remote
-- database connections. It reads only information_schema metadata, never returns
-- secrets, and does not allow arbitrary SQL.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_database_schema_read',
  'Tenant Database Schema Read',
  'Read table/column metadata from a tenant-owned remote database connection using information_schema only. Does not return credentials and does not run arbitrary SQL.',
  'GET',
  '/me/infrastructure/database/connections/{connection_id}/schema',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'table_like',JSON_OBJECT('type','string','description','Optional table name LIKE filter. Supports % or * wildcards.'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',500,'default',100)
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,database,schema,read_only,information_schema,no_secrets,no_arbitrary_sql,auth_scoped,specific_path',
  1,
  324
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
