-- Sprint 64: governed Codex interactive-user execution request/status tools.
-- These tools enqueue/read a Local Manager desktop command for read-only Codex
-- execution under the logged-in Windows user. No platform secret is copied,
-- no credential cache is read, and repo mutation remains disabled.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'dev_agent_codex_interactive_execution_request',
  'Codex Interactive Execution Request',
  'Queue a read-only Codex exec request through the Local Manager desktop command bridge. Executes only under the logged-in interactive Windows user and never copies secrets.',
  'POST',
  '/dev-agent/summary-development/codex-interactive-execution-request',
  NULL,
  '{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"runtime_key":{"type":"string","default":"codex_essam_chatgpt_v1"},"profile_key":{"type":"string","default":"codex_essam_chatgpt_oauth_v1"},"prompt":{"type":"string"},"analysis_goal":{"type":"string"},"repo_path":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":30,"maximum":1800},"output_max_chars":{"type":"integer","minimum":500,"maximum":20000},"ttl_seconds":{"type":"integer","minimum":60,"maximum":3600},"priority":{"type":"integer","minimum":1,"maximum":1000},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,codex,execution_request,local_manager,interactive_user,read_only,no_repo_mutation,no_secrets',
  1,
  152
),
(
  'dev_agent_codex_interactive_execution_status',
  'Codex Interactive Execution Status',
  'Read status and sanitized result for a Codex interactive execution request.',
  'GET',
  '/dev-agent/summary-development/codex-interactive-execution/{runId}',
  '["runId"]',
  '{"type":"object","required":["runId"],"properties":{"runId":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,codex,execution_status,local_manager,read_only,no_secrets',
  1,
  153
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

-- Keep the generic desktop enqueue tool schema in sync with the new governed action.
UPDATE `admin_platform_endpoint_tools`
SET `input_schema` = JSON_SET(
  CAST(`input_schema` AS JSON),
  '$.properties.action.enum',
  JSON_ARRAY('open_url', 'open_n8n', 'notify', 'focus_local_manager', 'codex_exec_readonly')
)
WHERE `tool_key` = 'local_manager_desktop_command_enqueue'
  AND JSON_VALID(`input_schema`);
