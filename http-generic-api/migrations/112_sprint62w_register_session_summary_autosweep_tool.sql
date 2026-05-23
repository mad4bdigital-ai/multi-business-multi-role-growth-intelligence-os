-- Sprint 62w: expose session summary autosweep through governed admin tool registry.
-- Keeps manual live smoke and small bounded sweeps behind /gpt/tools/call.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_session_summary_autosweep',
  'Dev Agent Session Summary Autosweep',
  'Run a bounded Drive-first GPT session summary autosweep. Admin-only and governed through the tool dispatcher. Use small limits for live smoke tests.',
  'POST',
  '/dev-agent/session-summaries/autosweep',
  NULL,
  '{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":100,"default":1},"min_turn_count":{"type":"integer","minimum":1,"default":1},"include_active_long":{"type":"boolean","default":false},"active_turn_threshold":{"type":"integer","minimum":1,"default":80},"min_new_turns":{"type":"integer","minimum":1,"default":1}}}',
  NULL,
  'dev_agent,session_summary,state_changing,audited',
  1,
  120
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
