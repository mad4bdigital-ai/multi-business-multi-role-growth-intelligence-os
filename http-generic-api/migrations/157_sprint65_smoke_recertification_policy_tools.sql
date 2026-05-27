-- Sprint 65: register smoke recertification policy registry tools.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_smoke_recertification_policy_resolve',
  'Resolve Platform Plugin Smoke Recertification Policy',
  'Resolve the effective smoke recertification policy by tenant/plugin/action/mock provider/resource. Returns safe policy metadata only.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/resolve',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"plugin_key":{"type":"string"},"action_key":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"provider":{"type":"string"},"resource":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,resolve,read_only,no_secrets,audited',
  1,
  468
),
(
  'platform_plugin_smoke_recertification_policy_list',
  'List Platform Plugin Smoke Recertification Policies',
  'List smoke recertification policy registry rows. Returns safe policy metadata only.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/list',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"plugin_key":{"type":"string"},"action_key":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"status":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,list,read_only,no_secrets,audited',
  1,
  469
),
(
  'platform_plugin_smoke_recertification_policy_upsert',
  'Upsert Platform Plugin Smoke Recertification Policy',
  'Create or update a smoke recertification policy for a tenant/plugin/action/mock scope. Controls TTL, expiring-soon window, max batch size, auto enablement, and expected origin guard.',
  'POST',
  '/platform/plugins/smoke-certifications/policies/upsert',
  NULL,
  '{"type":"object","properties":{"policy_id":{"type":"string"},"tenant_id":{"type":"string"},"plugin_key":{"type":"string","default":"*"},"action_key":{"type":"string"},"mock_provider":{"type":"string"},"mock_resource":{"type":"string"},"certification_ttl_days":{"type":"integer","minimum":1,"maximum":365,"default":90},"expires_soon_days":{"type":"integer","minimum":1,"maximum":90,"default":14},"max_batch_size":{"type":"integer","minimum":1,"maximum":10,"default":5},"auto_recertification_enabled":{"type":"boolean","default":false},"provider_smoke_required":{"type":"boolean","default":true},"allowed_expected_origin":{"type":"string"},"status":{"type":"string","default":"active"},"priority":{"type":"integer","default":100},"notes":{"type":"string"},"metadata":{"type":"object","additionalProperties":true}},"additionalProperties":false}',
  NULL,
  'platform-plugin,smoke,recertification,policy,upsert,state_changing,no_secrets,audited,origin_guard',
  1,
  470
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
