-- Sprint 64: certify and promote Platform Plugin contributions to Platform Base.
-- Private owner-scoped usage is separate; promotion makes a certified contribution available as app_integrations base metadata.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_contribution_certify',
  'Certify Platform Plugin Contribution',
  'Run admin certification checks for a Platform Plugin contribution. Updates validation_report_json and certification status, but does not promote to Platform Base.',
  'POST',
  '/platform/plugins/contributions/certify',
  NULL,
  '{"type":"object","required":["contribution_id"],"properties":{"contribution_id":{"type":"string"},"admin_user_id":{"type":"string"},"notes":{"type":"string","maxLength":1000}}}',
  NULL,
  'admin,platform-plugin,contribution,certification,state_changing,audited,no_secrets,promotion_gate',
  1,
  131
),
(
  'platform_plugin_contribution_promote',
  'Promote Platform Plugin Contribution',
  'Promote a certified Platform Plugin contribution into Platform Base app_integrations and action bindings. Requires prior certification.',
  'POST',
  '/platform/plugins/contributions/promote',
  NULL,
  '{"type":"object","required":["contribution_id"],"properties":{"contribution_id":{"type":"string"},"admin_user_id":{"type":"string"},"status":{"type":"string","enum":["beta","active"],"default":"beta"},"notes":{"type":"string","maxLength":1000}}}',
  NULL,
  'admin,platform-plugin,contribution,promotion,state_changing,audited,no_secrets,platform_base_mutation',
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
