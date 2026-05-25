INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `input_schema`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'dev_agent_summary_comparison_report',
    'Dev Agent Summary Comparison Report',
    'Read aggregate and recent-run diagnostics for summary comparison experiments. Read-only and does not touch session_summaries.',
    'GET',
    '/dev-agent/summary-comparison/report',
    '{"type":"object","properties":{"lookback_days":{"type":"integer","minimum":1,"maximum":90,"default":7},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"n8n_binding_key":{"type":"string"}},"additionalProperties":false}',
    'dev_agent,session_summary,comparison,diagnostics,read_only,audited',
    1,
    125
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `input_schema` = VALUES(`input_schema`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
