-- Sprint 64: expose Platform Plugin resolver preview through governed admin tool registry.
-- This is a read-only resolver surface. It evaluates plugin/action/tool availability,
-- tenant policy, user connection state, and agent skill grants, but never executes actions.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_resolve',
  'Resolve Platform Plugin Execution Preview',
  'Resolve whether a Platform Plugin action/tool is currently allowed for a tenant/user/agent context. Preview only; no action execution or secret return.',
  'POST',
  '/platform/plugins/resolve',
  NULL,
  '{"type":"object","required":["plugin_key"],"properties":{"plugin_key":{"type":"string"},"action_key":{"type":"string"},"tool_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"agent_id":{"type":"string"},"requested_credential_scope":{"type":"string","enum":["user_connection","tenant_connection","platform_managed","device_connector","none"]}}}',
  NULL,
  'admin,platform-plugin,resolver,read_only,diagnostics,audited,preview_only',
  1,
  123
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
