-- Sprint 65: full execution readiness dry-run diagnostic.
-- This is read-only and never dispatches providers. It combines Action → Endpoint → Tool
-- manifest guard preview with Brand, Business Activity, Workflow/Logic, Skills, and
-- Platform Graph context.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'execution_readiness_dry_run',
  'Execution Readiness Dry Run',
  'Read-only full execution readiness dry-run. Combines action manifest guard preview with Brand, Business Activity, Workflow/Logic, Skills, and Platform Graph context. Never executes providers or exposes secrets.',
  'POST',
  '/platform/execution-readiness/dry-run',
  NULL,
  '{"type":"object","properties":{"action_key":{"type":"string"},"endpoint_key":{"type":"string"},"plugin_key":{"type":"string"},"tool_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"brand_key":{"type":"string"},"target_key":{"type":"string"},"business_type_key":{"type":"string"},"business_activity_type_key":{"type":"string"},"workflow_key":{"type":"string"},"logic_key":{"type":"string"},"logic_pack_key":{"type":"string"},"agent_id":{"type":"string"},"skill_key":{"type":"string"},"actor_role":{"type":"string"},"governance_level":{"type":"string"},"preview_enforce":{"type":"boolean","default":true},"require_plugin_connection":{"type":"boolean","default":true},"graph_depth":{"type":"integer","default":2},"graph_limit":{"type":"integer","default":250}},"additionalProperties":false}',
  NULL,
  'execution-readiness,dry-run,authority,brand,business-activity,logic,skills,platform-graph,read_only,secret_free',
  1,
  463
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
