-- Sprint 65: register smoke recertification queue and bounded batch tools.
-- Queue is read-only. Batch defaults to dry_run=true and only real-runs provider_smoke
-- for rows with no origin/path/method drift and explicit expected origin evidence.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_smoke_recertification_queue',
  'Platform Plugin Smoke Recertification Queue',
  'List Platform Plugin smoke certifications that are expired, expiring soon, or drifting from their current connection/endpoint URL or method. Returns safe metadata only.',
  'POST',
  '/platform/plugins/smoke-certifications/recertification-queue',
  NULL,
  '{"type":"object","properties":{"plugin_key":{"type":"string"},"action_key":{"type":"string"},"tenant_id":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"provider":{"type":"string"},"resource":{"type":"string"},"expires_soon_days":{"type":"integer","minimum":1,"maximum":90,"default":14},"include_ok":{"type":"boolean","default":false},"limit":{"type":"integer","minimum":1,"maximum":250,"default":50}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,queue,read_only,no_secrets,audited',
  1,
  466
),
(
  'platform_plugin_smoke_recertification_batch',
  'Platform Plugin Smoke Recertification Batch',
  'Run a bounded smoke recertification batch. Defaults to dry_run=true. Real execution uses provider_smoke only for rows with no drift and an explicit expected origin, then re-certifies successful 200 responses.',
  'POST',
  '/platform/plugins/smoke-certifications/recertification-batch',
  NULL,
  '{"type":"object","properties":{"plugin_key":{"type":"string"},"action_key":{"type":"string"},"tenant_id":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"expires_soon_days":{"type":"integer","minimum":1,"maximum":90,"default":14},"dry_run":{"type":"boolean","default":true},"limit":{"type":"integer","minimum":1,"maximum":10,"default":5},"certification_ttl_days":{"type":"integer","minimum":1,"maximum":365,"default":90},"certified_by":{"type":"string"},"notes":{"type":"string"},"agent_id":{"type":"string"},"requested_credential_scope":{"type":"string","default":"tenant_connection"},"brand_key":{"type":"string"},"business_type_key":{"type":"string"},"business_activity_type_key":{"type":"string"},"actor_role":{"type":"string"},"governance_level":{"type":"string"},"timeout_ms":{"type":"integer","minimum":1000,"maximum":30000,"default":5000}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,batch,provider_smoke,state_changing,no_secrets,audited,origin_guard',
  1,
  467
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
