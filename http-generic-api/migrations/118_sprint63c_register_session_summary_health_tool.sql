-- Sprint 63c: expose SQL-primary session summary health through governed admin tool registry.
-- Read-only monitoring surface for summary execution_log rows and Drive archive coverage.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_session_summary_health',
  'Dev Agent Session Summary Health',
  'Read SQL-primary session summary health: execution_log statuses, transcript fallback warnings, archive coverage, backlog, and recent summary runs.',
  'GET',
  '/dev-agent/session-summaries/health',
  NULL,
  '{"type":"object","properties":{"lookback_days":{"type":"integer","minimum":1,"maximum":90,"default":7},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20}}}',
  NULL,
  'dev_agent,session_summary,read_only,audited',
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
