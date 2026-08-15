-- Custom GPT MCP catalog levels
-- Keeps every generated Custom GPT schema at <=30 operations while retaining
-- broader governed operations in specialized DB-backed endpoint registries.
-- No secrets are stored. No write scope is activated by this migration.

ALTER TABLE `admin_platform_endpoint_tools`
  ADD COLUMN IF NOT EXISTS `mcp_catalog_level` VARCHAR(64) NOT NULL DEFAULT 'core'
    COMMENT 'Governed MCP catalog level exposed through listTools/system tools.' AFTER `tags`;

ALTER TABLE `tenant_platform_endpoint_tools`
  ADD COLUMN IF NOT EXISTS `mcp_catalog_level` VARCHAR(64) NOT NULL DEFAULT 'core'
    COMMENT 'Governed MCP catalog level exposed through listTools/system tools.' AFTER `tags`;

ALTER TABLE `admin_platform_endpoint_tools`
  ADD KEY IF NOT EXISTS `idx_enabled_mcp_level_sort` (`is_enabled`, `mcp_catalog_level`, `sort_order`);

ALTER TABLE `tenant_platform_endpoint_tools`
  ADD KEY IF NOT EXISTS `idx_enabled_mcp_level_sort` (`is_enabled`, `mcp_catalog_level`, `sort_order`);

UPDATE `admin_platform_endpoint_tools`
   SET `mcp_catalog_level` = CASE
     WHEN `tags` LIKE '%resource_api%' THEN 'resource_api'
     WHEN `tags` LIKE '%activation%' THEN 'activation'
     WHEN `tags` LIKE '%device%' THEN 'device'
     WHEN `tags` LIKE '%session%' THEN 'session_lifecycle'
     WHEN `tags` LIKE '%plugin%' THEN 'plugin_lifecycle'
     ELSE 'core'
   END;

UPDATE `tenant_platform_endpoint_tools`
   SET `mcp_catalog_level` = CASE
     WHEN `tags` LIKE '%resource_api%' THEN 'resource_api'
     WHEN `tags` LIKE '%activation%' THEN 'activation'
     WHEN `tags` LIKE '%device%' THEN 'device'
     WHEN `tags` LIKE '%session%' THEN 'session_lifecycle'
     WHEN `tags` LIKE '%plugin%' THEN 'plugin_lifecycle'
     WHEN `tags` LIKE '%recommendation_feedback%' THEN 'growth_feedback'
     ELSE 'core'
   END;

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `tags`, `mcp_catalog_level`, `sort_order`)
VALUES
  (
    'tenant_growth_recommendation_feedback',
    'Tenant Growth Recommendation Feedback',
    'Record a bounded tenant recommendation outcome; no secrets are accepted or returned.',
    'POST',
    '/tenant/dashboard/recommendations/{recommendationId}/feedback',
    '["recommendationId"]',
    JSON_OBJECT(
      'type','object',
      'additionalProperties',FALSE,
      'required',JSON_ARRAY('event_type'),
      'properties',JSON_OBJECT(
        'event_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('shown','opened','accepted','dismissed','executed','failed','result_observed')),
        'reason_code',JSON_OBJECT('type','string','enum',JSON_ARRAY('not_relevant','wrong_timing','too_expensive','already_done','missing_information','other')),
        'workspace_id',JSON_OBJECT('type','string'),
        'recommendation_key',JSON_OBJECT('type','string'),
        'tab_key',JSON_OBJECT('type','string'),
        'card_id',JSON_OBJECT('type','string'),
        'result_metric_key',JSON_OBJECT('type','string'),
        'result_value',JSON_OBJECT('type','object','additionalProperties',TRUE),
        'context',JSON_OBJECT('type','object','additionalProperties',TRUE)
      )
    ),
    'growth_dashboard,growth_feedback,tenant_scoped,mutation,readback,no_secrets',
    'growth_feedback',
    12011
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `tags` = VALUES(`tags`),
  `mcp_catalog_level` = VALUES(`mcp_catalog_level`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

-- This migration is registry metadata only. Production mutation and write-scope
-- activation remain governed elsewhere and fail closed.
