-- Sprint 64: governed execution-envelope tool for future read-only OpenClaude runs.
-- Validates an approval and creates a traceable execution envelope only. It does
-- not execute OpenClaude, run shell commands, or mutate repositories.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_summary_development_execution_envelope',
  'Summary Development Execution Envelope',
  'Validate a short-lived read-only OpenClaude approval and create a traceable execution envelope. Does not execute the local agent.',
  'POST',
  '/dev-agent/summary-development/repo-analysis-execution-envelope',
  NULL,
  '{"type":"object","required":["approval_id"],"properties":{"approval_id":{"type":"string"},"analysis_goal":{"type":"string"},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,execution_envelope,approval,read_only,no_code_execution,no_repo_mutation',
  1,
  147
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
