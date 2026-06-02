-- Sprint 66: governed WordPress draft smoke admin tool
-- Admin-only, no secret return. Uses server-side stored credentials and creates a draft only.

INSERT INTO admin_platform_endpoint_tools (
  tool_key,
  display_name,
  description,
  http_method,
  http_path,
  path_param_keys,
  input_schema,
  fixed_body,
  tags,
  is_enabled,
  sort_order
) VALUES (
  'wordpress_blog_publish_draft_smoke',
  'WordPress Blog Publish Draft Smoke',
  'Run an admin-only governed WordPress draft publish smoke through the WordPress publish orchestrator. Requires tenant_id, user_id, connection_id, and brand_key or target_key. Creates a draft only and returns sanitized result metadata; no secrets are returned.',
  'POST',
  '/wordpress/blog-publish-smoke',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type', 'object',
    'required', JSON_ARRAY('tenant_id', 'user_id', 'connection_id'),
    'properties', JSON_OBJECT(
      'tenant_id', JSON_OBJECT('type', 'string'),
      'user_id', JSON_OBJECT('type', 'string'),
      'connection_id', JSON_OBJECT('type', 'string'),
      'brand_key', JSON_OBJECT('type', 'string'),
      'target_key', JSON_OBJECT('type', 'string'),
      'title', JSON_OBJECT('type', 'string'),
      'content', JSON_OBJECT('type', 'string')
    ),
    'additionalProperties', true
  ),
  NULL,
  'admin,wordpress,smoke,draft,read_write,no_secrets,governed',
  1,
  165
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
