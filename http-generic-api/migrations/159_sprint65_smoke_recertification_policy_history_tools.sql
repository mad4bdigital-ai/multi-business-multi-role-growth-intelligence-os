-- Sprint 65: smoke recertification policy history and rollback tools.
-- History and preview are read-only. Apply writes through audited policy upsert path.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_smoke_recertification_policy_history',
  'Platform Plugin Smoke Recertification Policy History',
  'Read execution-log audit history for smoke recertification policy upserts. Supports policy id, actor, changed field, and reason filters. Returns safe before/after summaries only.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/history',
  NULL,
  '{"type":"object","properties":{"policy_id":{"type":"string"},"actor":{"type":"string"},"actor_id":{"type":"string"},"changed_field":{"type":"string"},"reason_contains":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":100}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,history,read_only,no_secrets,audited',
  1,
  471
),
(
  'platform_plugin_smoke_recertification_policy_rollback_preview',
  'Platform Plugin Smoke Recertification Policy Rollback Preview',
  'Preview rollback from a policy upsert audit row. Returns target snapshot, current policy, changed fields, and rollback safety notes without mutating state.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/rollback-preview',
  NULL,
  '{"type":"object","properties":{"audit_log_id":{"type":"integer"},"trace_id":{"type":"string"},"rollback_to":{"type":"string","enum":["before","after"],"default":"before"}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,rollback,preview,read_only,no_secrets,audited',
  1,
  472
),
(
  'platform_plugin_smoke_recertification_policy_rollback_apply',
  'Apply Platform Plugin Smoke Recertification Policy Rollback',
  'Apply rollback from a policy upsert audit row. Requires confirm_rollback=true and writes a new execution-log audit row through the audited policy upsert path.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/rollback-apply',
  NULL,
  '{"type":"object","properties":{"audit_log_id":{"type":"integer"},"trace_id":{"type":"string"},"rollback_to":{"type":"string","enum":["before","after"],"default":"before"},"confirm_rollback":{"type":"boolean","default":false},"actor":{"type":"string"},"actor_id":{"type":"string"},"admin_user_id":{"type":"string"},"reason":{"type":"string"},"change_reason":{"type":"string"},"rollback_trace_id":{"type":"string"},"notes":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,rollback,apply,state_changing,no_secrets,audited,execution_log_audit',
  1,
  473
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
