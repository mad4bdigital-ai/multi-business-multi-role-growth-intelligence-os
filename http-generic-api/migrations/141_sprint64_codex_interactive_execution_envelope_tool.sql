-- Sprint 64: governed Codex interactive-user execution envelope.
-- Creates a traceable read-only Codex command envelope for an already logged-in
-- interactive Windows user. This route does not execute Codex, run shell commands,
-- read credential caches, copy secrets, or mutate repositories.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_codex_interactive_execution_envelope',
  'Codex Interactive Execution Envelope',
  'Create a read-only Codex exec command envelope for the logged-in interactive Windows user. Does not execute Codex or mutate repositories.',
  'POST',
  '/dev-agent/summary-development/codex-interactive-execution-envelope',
  NULL,
  '{"type":"object","properties":{"runtime_key":{"type":"string","default":"codex_essam_chatgpt_v1"},"profile_key":{"type":"string","default":"codex_essam_chatgpt_oauth_v1"},"signal_id":{"type":"string"},"prompt":{"type":"string"},"analysis_goal":{"type":"string"},"repo_path":{"type":"string"},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,codex,execution_envelope,interactive_user,read_only,no_code_execution,no_repo_mutation,no_secrets',
  1,
  151
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
