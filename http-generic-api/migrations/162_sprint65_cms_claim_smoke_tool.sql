-- Sprint 65: CMS/WordPress claim approval smoke harness.
-- Admin-only smoke harness for CMS claim approval -> tenant credential binding pointer.
-- Does not return User JWT, tokens, decrypted credentials, or secret values.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_evolution_cms_claim_smoke',
  'Platform Evolution CMS Claim Smoke',
  'Admin-only smoke harness for CMS/WordPress claim approval governance. Uses an internal short-lived User JWT check and direct_scope approval/promotion logic to verify a CMS claim can approve and resolve through a tenant-owned WordPress credential binding pointer without returning secrets or tokens.',
  'POST',
  '/platform/evolution/cms-claim-smoke',
  NULL,
  '{"type":"object","required":["tenant_id","connection_id","target_key"],"properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"connection_id":{"type":"string"},"target_key":{"type":"string"},"site_url":{"type":"string"},"normalized_domain":{"type":"string"},"credential_role":{"type":"string","default":"wordpress_app_password"},"claim_id":{"type":"string"},"transport_mode":{"type":"string","enum":["direct_scope"],"default":"direct_scope"}},"additionalProperties":false}',
  NULL,
  'platform-evolution,cms,wordpress,claim-smoke,user-jwt,certification,read_write,scope_gated,no_secrets,no_token_returned,no_secret_copy,direct_scope',
  1,
  476
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
