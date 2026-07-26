-- Sprint 66: Tenant remote database read-only query tool
-- Adds a tightly guarded tenant-facing SELECT-only query tool for user-owned
-- remote database connections. It rejects multiple statements, comments,
-- DDL/DML/admin statements, SELECT *, secret-like field references, and caps
-- rows returned with an outer LIMIT. It never returns credentials.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_database_query_readonly',
  'Tenant Database Read-only Query',
  'Execute a tightly guarded SELECT-only query against a tenant-owned remote database connection. Rejects arbitrary SQL patterns, comments, multiple statements, SELECT *, secret-like fields, and caps returned rows.',
  'POST',
  '/me/infrastructure/database/connections/{connection_id}/query-readonly',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id','sql'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'sql',JSON_OBJECT('type','string','description','Single SELECT statement only. No comments, semicolons, DDL/DML/admin statements, SELECT *, placeholders, or secret-like fields.'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,database,query,read_only,select_only,no_secrets,no_ddl,no_dml,no_multiple_statements,no_select_star,no_secret_columns,auth_scoped,specific_path',
  1,
  325
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
