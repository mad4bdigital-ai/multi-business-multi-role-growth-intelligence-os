CREATE TABLE IF NOT EXISTS `summary_comparison_runs` (
  `comparison_id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) DEFAULT NULL,
  `user_id` varchar(64) DEFAULT NULL,
  `n8n_binding_key` varchar(128) NOT NULL DEFAULT 'summary_n8n_experiment_v1',
  `input_text_chars` int NOT NULL DEFAULT 0,
  `input_turn_count` int NOT NULL DEFAULT 0,
  `current_model_ok` tinyint(1) NOT NULL DEFAULT 0,
  `current_model_latency_ms` int DEFAULT NULL,
  `current_model_summary_chars` int DEFAULT NULL,
  `current_model_bullet_count` int DEFAULT NULL,
  `current_model_source` varchar(128) DEFAULT NULL,
  `current_model_method` varchar(255) DEFAULT NULL,
  `n8n_ok` tinyint(1) NOT NULL DEFAULT 0,
  `n8n_latency_ms` int DEFAULT NULL,
  `n8n_summary_chars` int DEFAULT NULL,
  `n8n_bullet_count` int DEFAULT NULL,
  `n8n_source` varchar(128) DEFAULT NULL,
  `n8n_method` varchar(255) DEFAULT NULL,
  `faster_path` varchar(64) DEFAULT NULL,
  `production_route_unchanged` tinyint(1) NOT NULL DEFAULT 1,
  `writes_session_summaries` tinyint(1) NOT NULL DEFAULT 0,
  `result_json` longtext DEFAULT NULL CHECK (json_valid(`result_json`)),
  `notes` varchar(512) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`comparison_id`),
  KEY `idx_summary_comparison_runs_created_at` (`created_at`),
  KEY `idx_summary_comparison_runs_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_summary_comparison_runs_binding_created` (`n8n_binding_key`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `input_schema`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'dev_agent_summary_comparison_run',
    'Dev Agent Summary Comparison Run',
    'Compare the current model-backed summary path with the explicit n8n summary experiment binding. Does not change production routing and does not write session_summaries.',
    'POST',
    '/dev-agent/summary-comparison/run',
    '{"type":"object","properties":{"text":{"type":"string"},"content":{"type":"string"},"turns":{"type":"array","items":{"type":"object","properties":{"role":{"type":"string"},"content":{"type":"string"},"text":{"type":"string"},"turn_index":{"type":"number"},"action_key":{"type":"string"}}}},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"n8n_binding_key":{"type":"string","default":"summary_n8n_experiment_v1"},"max_bullets":{"type":"number"},"max_chars":{"type":"number"}},"additionalProperties":true}',
    'dev_agent,session_summary,comparison,diagnostics,state_changing,audited',
    1,
    124
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
