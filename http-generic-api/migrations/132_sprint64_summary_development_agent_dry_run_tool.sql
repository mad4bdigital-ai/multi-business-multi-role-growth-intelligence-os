-- Sprint 64: governed summary-development agent dry-run tool.
-- This exposes plan-only agent handoff for local coding-agent runtimes such as
-- OpenClaude. It intentionally blocks local execution and repository mutation.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'dev_agent_summary_development_agent_dry_run',
  'Summary Development Agent Dry Run',
  'Create a plan-only development-agent dry run for a summary-derived signal. Does not execute OpenClaude, run code, or mutate repositories.',
  'POST',
  '/dev-agent/summary-development/agent-dry-run',
  NULL,
  '{"type":"object","properties":{"signal_id":{"type":"string"},"signal_key":{"type":"string"},"runtime_key":{"type":"string","default":"openclaude_essam_local_v1"},"mode":{"type":"string","enum":["plan_only"],"default":"plan_only"},"requested_by":{"type":"string"}}}',
  NULL,
  'dev_agent,summary_development,agent,dry_run,guarded_write,no_code_execution',
  1,
  144
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
