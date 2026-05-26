-- Sprint 65: governed Platform Plugin REST action template upsert tool.
-- This mutation updates non-secret method/path/header/body template metadata inside platform_plugin_contributions.action_bindings_json.
-- Credentials and secret payloads must use credential intake / user_app_connections instead.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_action_template_upsert',
  'Upsert Platform Plugin Action Template',
  'Create or update a REST action template for a Platform Plugin contribution action. Validates contribution/action scope, stores method/path/headers/body_template metadata in action_bindings_json, rejects secret-like keys and blocked auth headers, and enables public/private REST dispatch to resolve templates without exposing credentials.',
  'POST',
  '/platform/plugins/action-templates',
  NULL,
  '{"type":"object","required":["action_key","method","path"],"properties":{"contribution_id":{"type":"string"},"plugin_key":{"type":"string"},"action_key":{"type":"string"},"method":{"type":"string","enum":["GET","POST","PUT","PATCH","DELETE"]},"path":{"type":"string"},"headers":{"type":"object","additionalProperties":true},"body_template":{"type":"object","additionalProperties":true},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"updated_by":{"type":"string"}}}',
  NULL,
  'admin,platform-plugin,platform-plugins,action-template,rest,state_changing,audited,no_secrets,dispatch_template',
  1,
  132
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
