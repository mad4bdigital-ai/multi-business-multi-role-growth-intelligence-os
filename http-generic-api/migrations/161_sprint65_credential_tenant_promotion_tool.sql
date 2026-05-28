-- Sprint 65: Credential lifecycle tenant promotion tool.
-- Promotes a private active user_app_connection into a tenant-owned credential binding pointer.
-- Does not copy, decrypt, or return secret values. Platform-wide promotion is intentionally not supported in v1.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'credential_binding_promote_tenant',
  'Promote Connection Credential To Tenant Binding',
  'Admin-only credential lifecycle action that promotes an active user_app_connection into a tenant-owned credential binding pointer for a target/action/credential_role. It never copies/decrypts/returns secret values and platform-wide promotion is disabled in v1.',
  'POST',
  '/credentials/bindings/promote',
  NULL,
  '{"type":"object","required":["tenant_id","connection_id","credential_role"],"properties":{"tenant_id":{"type":"string"},"connection_id":{"type":"string"},"target_key":{"type":"string"},"action_key":{"type":"string"},"credential_role":{"type":"string"},"provider_family":{"type":"string","default":"wordpress"},"connector_family":{"type":"string","default":"wordpress_rest"},"promoted_owner_type":{"type":"string","enum":["tenant"],"default":"tenant"},"resolution_priority":{"type":"integer","default":20},"allow_platform_fallback":{"type":"boolean","default":true},"created_by":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'credentials,lifecycle,promotion,tenant_binding,read_write,no_secrets,no_token_returned,no_secret_copy,admin,scope_gated',
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
