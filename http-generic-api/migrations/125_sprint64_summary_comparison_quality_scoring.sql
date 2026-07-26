ALTER TABLE `summary_comparison_runs`
  ADD COLUMN IF NOT EXISTS `preferred_output` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `quality_score_model` tinyint DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `quality_score_n8n` tinyint DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `quality_notes` varchar(1000) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `use_case_fit` varchar(128) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `reviewed_by` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `reviewed_at` datetime DEFAULT NULL;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `input_schema`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'dev_agent_summary_comparison_score',
    'Dev Agent Summary Comparison Score',
    'Attach manual quality scoring to a persisted summary comparison run. Updates only summary_comparison_runs and does not touch session_summaries.',
    'POST',
    '/dev-agent/summary-comparison/score',
    '{"type":"object","required":["comparison_id","preferred_output"],"properties":{"comparison_id":{"type":"string"},"preferred_output":{"type":"string","enum":["current_model_summary","n8n_experiment","tie","neither"]},"quality_score_model":{"type":"integer","minimum":1,"maximum":5},"quality_score_n8n":{"type":"integer","minimum":1,"maximum":5},"quality_notes":{"type":"string"},"use_case_fit":{"type":"string"},"reviewed_by":{"type":"string"},"user_id":{"type":"string"}},"additionalProperties":false}',
    'dev_agent,session_summary,comparison,quality_scoring,state_changing,audited',
    1,
    126
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
