-- Sprint 64: governed approval tool for future read-only OpenClaude repo analysis.
-- Creates an approval record only; does not execute OpenClaude and does not mutate repositories.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_summary_development_repo_analysis_approve',
  'Approve Summary Development Repo Analysis',
  'Create a short-lived approval for future read-only OpenClaude repo analysis on a summary-derived signal. Requires explicit approval phrase and does not execute the local agent.',
  'POST',
  '/dev-agent/summary-development/repo-analysis-approve',
  NULL,
  '{"type":"object","required":["signal_id","approval_phrase"],"properties":{"signal_id":{"type":"string"},"signal_key":{"type":"string"},"runtime_key":{"type":"string","default":"openclaude_essam_local_v1"},"repo_scope":{"type":"string","enum":["platform_repo"],"default":"platform_repo"},"approval_phrase":{"type":"string","enum":["APPROVE_OPENCLAUDE_READ_ONLY_REPO_ANALYSIS"]},"ttl_minutes":{"type":"number","default":30},"approved_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,approval,repo_analysis,read_only,no_code_execution,no_repo_mutation',
  1,
  146
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
