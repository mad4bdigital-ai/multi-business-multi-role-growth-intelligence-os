-- Sprint 64: governed repo-analysis dry-run tool for summary-derived signals.
-- Produces an OpenClaude command plan with read-only tools only. This route
-- does not execute OpenClaude, run shell commands, or mutate repositories.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_summary_development_repo_analysis_dry_run',
  'Summary Development Repo Analysis Dry Run',
  'Create a read-only OpenClaude repo-analysis command plan for a summary-derived signal. Allows only Read/Grep/Glob/LS in the command plan and does not execute the local agent.',
  'POST',
  '/dev-agent/summary-development/repo-analysis-dry-run',
  NULL,
  '{"type":"object","required":["signal_id"],"properties":{"signal_id":{"type":"string"},"signal_key":{"type":"string"},"runtime_key":{"type":"string","default":"openclaude_essam_local_v1"},"repo_scope":{"type":"string","enum":["platform_repo"],"default":"platform_repo"},"analysis_goal":{"type":"string"},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,repo_analysis,dry_run,read_only,no_code_execution,no_repo_mutation',
  1,
  145
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
