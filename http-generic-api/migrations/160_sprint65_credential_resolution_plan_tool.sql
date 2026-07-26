-- Sprint 65: Credential lifecycle read-model and resolution plan tool.
-- Safe admin diagnostic: returns credential ownership, binding order, and fallback policy without secret values.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'credential_effective_plan',
  'Credential Effective Resolution Plan',
  'Read-only credential lifecycle diagnostic. Returns binding candidates, fallback order, tenant integration policies, and effective credential status for a tenant/action/target/role without returning secret values.',
  'POST',
  '/credentials/effective/plan',
  NULL,
  '{"type":"object","required":["tenant_id","credential_role"],"properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"connection_id":{"type":"string"},"action_key":{"type":"string"},"target_key":{"type":"string"},"credential_role":{"type":"string"},"allow_platform_fallback":{"type":"boolean","default":true}},"additionalProperties":false}',
  NULL,
  'credentials,lifecycle,resolution-plan,read_only,no_secrets,no_token_returned,admin,scope_gated',
  1,
  256
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
