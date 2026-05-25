-- Sprint 64: register governed Platform Plugin policy upsert.
-- This mutation installs or updates a tenant-scoped overlay in tenant_integration_policies.
-- It does not modify platform plugin definitions and does not accept credentials or secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_policy_upsert',
  'Upsert Platform Plugin Tenant Policy',
  'Install or update a tenant-scoped Platform Plugin policy overlay in tenant_integration_policies. Validates plugin and tenant, rejects secrets, performs readback, and logs execution evidence.',
  'POST',
  '/platform/plugins/install-policy',
  NULL,
  '{"type":"object","required":["tenant_id","plugin_key"],"properties":{"tenant_id":{"type":"string"},"plugin_key":{"type":"string"},"source_mode":{"type":"string","enum":["managed","dedicated"],"default":"managed"},"fallback_allowed":{"type":"boolean","default":false},"required_for_device_install":{"type":"boolean","default":false},"notes":{"type":"string","maxLength":1000},"user_id":{"type":"string"}}}',
  NULL,
  'admin,platform-plugin,policy,state_changing,audited,no_secrets,tenant_overlay',
  1,
  124
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
