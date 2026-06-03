-- Sprint 66: Platform secret intake promotion tool
-- Registers an admin-only promotion route that copies encrypted SSH key-pair
-- fields from a secure credential-intake connection into platform_secrets.
-- The route never accepts raw secret values and never returns decrypted values.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'credential_intake_promote_platform_secrets',
  'Promote Intake Credential To Platform Secrets',
  'Promote an active ssh_key_pair credential-intake connection into platform-scoped DB-encrypted secret slots. Does not accept or return raw secret values; the intake connection is decrypted server-side and mapped to platform_secrets.',
  'POST',
  '/credentials/intake/promote-platform-secrets',
  NULL,
  '{"type":"object","required":["connection_id","promotion_approved","promotion_reason"],"properties":{"connection_id":{"type":"string"},"system_id":{"type":"string","default":"98d6a18b-5578-11f1-9baf-8e76a7e1749f"},"owner_id":{"type":"string","default":"growth_intelligence_platform"},"target_key":{"type":"string","default":"hostinger_ssh_prod_platform"},"provider_family":{"type":"string","default":"hostinger"},"connector_family":{"type":"string","default":"hostinger_ssh"},"promotion_approved":{"type":"boolean"},"promotion_reason":{"type":"string","minLength":12},"created_by":{"type":"string"},"secret_mappings":{"type":"array","items":{"type":"object","required":["credential_field","secret_key"],"properties":{"credential_field":{"type":"string"},"secret_key":{"type":"string"},"secret_type":{"type":"string"}}}}},"additionalProperties":false}',
  NULL,
  'credentials,secure_intake,platform_secret,promotion,admin,state_changing,no_secrets,no_token_returned,requires_approval,scope_gated',
  1,
  271
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
