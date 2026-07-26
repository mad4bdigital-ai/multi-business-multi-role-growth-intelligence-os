-- Sprint 62y: expose model runtime readiness as governed diagnostic tool.
-- The route returns only provider/config presence and sanitized upstream status;
-- it must not expose model API keys or raw upstream error bodies.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_model_readiness',
  'Dev Agent Model Readiness',
  'Check whether dev-agent/session-summary model dependencies are wired and provider credentials validate. Returns sanitized diagnostics only, never secret values.',
  'GET',
  '/dev-agent/model-readiness',
  NULL,
  '{"type":"object","properties":{}}',
  NULL,
  'dev_agent,model,diagnostics,read_only',
  1,
  121
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
