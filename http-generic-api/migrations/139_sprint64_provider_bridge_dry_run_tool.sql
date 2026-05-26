-- Sprint 64: provider bridge dry-run tool.
-- Uses platform-managed model resolution to prove Gemini/OpenRouter-style bridge
-- viability without copying secrets to local devices or executing OpenClaude.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_provider_bridge_dry_run',
  'Provider Bridge Dry Run',
  'Run a platform-managed model dry run for an OpenClaude provider bridge profile. Does not copy secrets to Essam and does not execute the local agent.',
  'POST',
  '/dev-agent/summary-development/provider-bridge-dry-run',
  NULL,
  '{"type":"object","required":["prompt"],"properties":{"profile_key":{"type":"string","default":"openclaude_essam_platform_bridge_v1"},"prompt":{"type":"string"},"signal_id":{"type":"string"},"task_class":{"type":"string","default":"summary"},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,provider_bridge,openclaude,dry_run,platform_managed,no_secrets,no_local_execution',
  1,
  149
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
