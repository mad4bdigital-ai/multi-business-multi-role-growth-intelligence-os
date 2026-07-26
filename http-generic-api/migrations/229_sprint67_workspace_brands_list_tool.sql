-- Sprint 67 follow-up: tenant-safe workspace brand listing
-- Exposes brand records through scoped workspace resource authority, not activation diagnostic counts.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'workspace_brands_list',
  'Workspace Brands List',
  'List tenant-safe brand records visible to the signed-in workspace member through workspace resource grants and role scope. Does not use activation diagnostic counts as authority.',
  'GET',
  '/me/workspaces/{tenant_id}/brands',
  JSON_ARRAY('tenant_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string')),
    'required',JSON_ARRAY('tenant_id'),
    'additionalProperties',false
  ),
  NULL,
  'tenant,workspace,brands,resource_grants,role_inheritance,read_only,no_secrets',
  1,
  319
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order);
