-- Sprint 65: Platform Evolution governed tenant JWT smoke harness.
-- Admin-only smoke test for tenant /tenant/evolution/* routes using a short-lived internal User JWT.
-- The token is never returned. Tenant checkpoint write remains disabled.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_evolution_tenant_smoke',
  'Platform Evolution Tenant JWT Smoke',
  'Admin-only smoke harness that issues an internal short-lived User JWT for an allowed scope and calls tenant evolution switch-options, activation-card, and thread-map routes. The JWT is never returned and no secrets are returned.',
  'POST',
  '/platform/evolution/tenant-smoke',
  NULL,
  '{"type":"object","properties":{"user_id":{"type":"string"},"email":{"type":"string"},"tenant_id":{"type":"string"},"brand_key":{"type":"string"},"scope_key":{"type":"string"},"transport_mode":{"type":"string","enum":["direct_scope","http_self_call"],"default":"direct_scope"},"include_write":{"type":"boolean","default":false}},"additionalProperties":false}',
  NULL,
  'platform-evolution,tenant-smoke,user-jwt,certification,read_only,scope_gated,no_secrets,no_token_returned',
  1,
  474
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
