-- Sprint 64: governed tool for listing OpenClaude and platform provider profiles.
-- Read-only and secret-free.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_summary_development_providers',
  'Summary Development Providers',
  'List OpenClaude-native and platform-managed provider options plus runtime provider profiles. Read-only and never returns secrets.',
  'GET',
  '/dev-agent/summary-development/providers',
  NULL,
  '{"type":"object","properties":{"status":{"type":"string"},"runtime_key":{"type":"string","default":"openclaude_essam_local_v1"}}}',
  NULL,
  'dev_agent,summary_development,providers,openclaude,read_only,no_secrets',
  1,
  148
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
