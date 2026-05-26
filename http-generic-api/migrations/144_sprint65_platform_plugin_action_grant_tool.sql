-- Sprint 65: governed Platform Plugin action grant upsert tool.
-- This mutation writes approval gates into app_action_grants after plugin/action/connection validation.
-- No secrets are accepted or stored by this tool.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_action_grant_upsert',
  'Upsert Platform Plugin Action Grant',
  'Create or update an active action grant for a Platform Plugin connection. Validates app_integrations, app_integration_action_bindings, and user_app_connections before writing app_action_grants. This clears the resolver approval gate for matching action/connection scopes without accepting secrets.',
  'POST',
  '/platform/plugins/action-grants',
  NULL,
  '{"type":"object","required":["connection_id","plugin_key","action_key"],"properties":{"connection_id":{"type":"string"},"plugin_key":{"type":"string"},"action_key":{"type":"string"},"agent_id":{"type":"string"},"workspace_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"grant_mode":{"type":"string","enum":["explicit","default_permissive","auto_approved"],"default":"explicit"},"granted_by":{"type":"string"},"expires_at":{"type":"string","format":"date-time"}}}',
  NULL,
  'admin,platform-plugin,platform-plugins,action-grant,state_changing,audited,no_secrets,approval_gate',
  1,
  130
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
