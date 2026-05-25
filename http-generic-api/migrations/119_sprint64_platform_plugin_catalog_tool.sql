-- Sprint 64: expose the Platform Plugin read model through governed admin tool registry.
-- This is a read-only alias surface over existing app integration, binding, tenant policy,
-- and user connection tables. It does not create or mutate plugin definitions.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_catalog',
  'Platform Plugin Catalog',
  'Read the normalized Platform Plugin catalog from app_integrations, action/tool bindings, tenant integration policies, and user app connections. No secrets are returned.',
  'GET',
  '/platform/plugins/catalog',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string","description":"Optional tenant overlay scope."},"user_id":{"type":"string","description":"Optional user connection summary scope."},"include_inactive":{"type":"boolean","default":false},"include_bindings":{"type":"boolean","default":true},"limit":{"type":"integer","minimum":1,"maximum":250,"default":100}}}',
  NULL,
  'admin,platform-plugin,catalog,read_only,diagnostics,audited',
  1,
  122
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
