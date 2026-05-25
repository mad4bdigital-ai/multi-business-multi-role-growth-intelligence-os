-- Sprint 64: governed tools for summary development automation.
-- Read/list routes are diagnostics. Extract route converts evidence to signals
-- and optional pending tasks, but never executes code or mutates repositories.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'dev_agent_summary_development_runtimes',
    'Summary Development Agent Runtimes',
    'List configured development-agent runtimes such as Gemini, OpenRouter, and planned local OpenClaude. Read-only and never returns secrets.',
    'GET',
    '/dev-agent/summary-development/runtimes',
    NULL,
    '{"type":"object","properties":{"status":{"type":"string"}}}',
    NULL,
    'dev_agent,summary_development,runtime,read_only',
    1,
    141
  ),
  (
    'dev_agent_summary_development_signals',
    'Summary Development Signals',
    'List summary-derived development signals. Read-only; use this to review what the automation extracted before any task conversion.',
    'GET',
    '/dev-agent/summary-development/signals',
    NULL,
    '{"type":"object","properties":{"status":{"type":"string"},"signal_type":{"type":"string"},"limit":{"type":"number"}}}',
    NULL,
    'dev_agent,summary_development,signals,read_only',
    1,
    142
  ),
  (
    'dev_agent_summary_development_extract',
    'Extract Summary Development Signals',
    'Convert recent session summaries and summary comparison evidence into governed development signals and optionally platform pending tasks. This does not execute code or mutate repositories.',
    'POST',
    '/dev-agent/summary-development/extract',
    NULL,
    '{"type":"object","properties":{"lookback_days":{"type":"number"},"limit":{"type":"number"},"tenant_id":{"type":"string"},"create_pending_tasks":{"type":"boolean"},"requested_by":{"type":"string"}}}',
    NULL,
    'dev_agent,summary_development,signals,automation,guarded_write',
    1,
    143
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
