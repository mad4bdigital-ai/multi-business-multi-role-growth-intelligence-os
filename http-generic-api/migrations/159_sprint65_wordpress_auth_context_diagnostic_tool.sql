-- Sprint 65: safe WordPress REST auth context diagnostic

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'wordpress_auth_context_diagnostic',
  'WordPress Auth Context Diagnostic',
  'Diagnose which WordPress user and capabilities the REST API sees for a stored connection. Uses server-side credentials and returns sanitized user id, slug, roles, and create/edit/publish capability booleans only. Does not return secrets.',
  'POST',
  '/wordpress/auth-context/diagnose',
  '[]',
  '{"type":"object","additionalProperties":false,"required":["tenant_id","user_id"],"properties":{"tenant_id":{"type":"string","minLength":1},"user_id":{"type":"string","minLength":1},"connection_id":{"type":"string"},"brand_key":{"type":"string"},"target_key":{"type":"string"}},"anyOf":[{"required":["brand_key"]},{"required":["target_key"]}]}',
  NULL,
  'admin,wordpress,credentials,diagnostics,read_only,no_secrets',
  1,
  422
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
