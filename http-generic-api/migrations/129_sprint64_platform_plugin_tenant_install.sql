-- Sprint 64: install Platform Base plugins for a tenant/user with no-secret connection metadata.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_install',
  'Install Platform Plugin for Tenant',
  'Install an active/beta Platform Base plugin for a tenant by writing a tenant policy overlay and optional no-secret user_app_connections metadata. Credentials must be supplied later through governed credential intake or OAuth.',
  'POST',
  '/platform/plugins/install',
  NULL,
  '{"type":"object","required":["tenant_id","plugin_key"],"properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"plugin_key":{"type":"string"},"source_mode":{"type":"string","enum":["managed","dedicated"],"default":"dedicated"},"fallback_allowed":{"type":"boolean","default":false},"required_for_device_install":{"type":"boolean","default":false},"notes":{"type":"string","maxLength":1000},"connection":{"type":"object","properties":{"connection_scope":{"type":"string","enum":["tenant_connection","user_connection"],"default":"tenant_connection"},"api_base_url":{"type":"string"},"mcp_endpoint":{"type":"string"},"webhook_url":{"type":"string"},"account_label":{"type":"string"},"display_label":{"type":"string"},"account_metadata":{"type":"object"}}}}}',
  NULL,
  'admin,platform-plugin,install,state_changing,audited,no_secrets,tenant_overlay,connection_metadata',
  1,
  133
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
