-- Sprint 65: Governed credential pointer promotion.
-- Promotes a private user_app_connection credential pointer into a tenant/platform runtime binding.
-- Does not copy, decrypt, or return secret values.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'credential_binding_promote',
  'Promote Credential Binding',
  'Governed credential pointer promotion. Preflights a private connection credential with user+connection context, then creates or updates a tenant/platform runtime binding that points to the same credential_ref. Does not copy, decrypt, or return secret values.',
  'POST',
  '/credentials/bindings/promote',
  NULL,
  '{"type":"object","required":["tenant_id","user_id","connection_id","credential_role","promotion_approved","promotion_reason"],"properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"connection_id":{"type":"string"},"action_key":{"type":"string"},"target_key":{"type":"string"},"credential_role":{"type":"string"},"target_owner_type":{"type":"string","enum":["tenant","platform"],"default":"tenant"},"target_owner_id":{"type":"string"},"resolution_priority":{"type":"integer","minimum":1,"maximum":999,"default":20},"promotion_approved":{"type":"boolean","const":true},"promotion_reason":{"type":"string","minLength":8},"created_by":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'credentials,lifecycle,promotion,read_write,scope_gated,admin,no_secrets,no_token_returned,no_secret_copy,requires_approval',
  1,
  257
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
