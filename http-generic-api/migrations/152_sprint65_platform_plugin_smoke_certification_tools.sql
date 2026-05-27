-- Sprint 65: register Platform Plugin smoke certification admin tools.
-- Both tools are read-model/registry operations and never expose credential payloads.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_smoke_certify',
  'Certify Platform Plugin Smoke',
  'Create or update a Platform Plugin smoke certification from a successful guarded provider_smoke execution log. Requires GET, status 200, expected origin match, and secrets_included=false.',
  'POST',
  '/platform/plugins/smoke-certifications/certify',
  NULL,
  '{"type":"object","required":["execution_log_id"],"properties":{"execution_log_id":{"type":"integer"},"certification_id":{"type":"string"},"certified_by":{"type":"string"},"admin_user_id":{"type":"string"},"notes":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,certification,provider_smoke,read_only,no_secrets,audited',
  1,
  464
),
(
  'platform_plugin_smoke_certification_status',
  'Platform Plugin Smoke Certification Status',
  'Read Platform Plugin smoke certification status by plugin/action/mock provider/resource. Returns safe metadata and execution log references only.',
  'POST',
  '/platform/plugins/smoke-certifications/status',
  NULL,
  '{"type":"object","properties":{"plugin_key":{"type":"string"},"action_key":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"provider":{"type":"string"},"resource":{"type":"string"},"limit":{"type":"integer","default":20}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,certification,status,read_only,no_secrets,audited',
  1,
  465
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
