-- Sprint 65: Platform Evolution user switch read tools.
-- Adds scoped switch-option discovery for admin and tenant users.
-- Switch means selecting an allowed scope_key; it does not grant new access and does not expose checkpoint write.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_evolution_switch_options',
  'Platform Evolution Switch Options',
  'Admin read of allowed Platform Evolution scope switch options for a user, tenant, brand, or email. Supports view-as/scope selection without granting access or exposing secrets.',
  'GET',
  '/platform/evolution/switch-options',
  NULL,
  '{"type":"object","properties":{"user_id":{"type":"string"},"email":{"type":"string"},"tenant_id":{"type":"string"},"brand_key":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250,"default":50}},"additionalProperties":false}',
  NULL,
  'platform-evolution,user-switch,switch-options,read_only,scope_gated,no_secrets',
  1,
  469
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

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_evolution_switch_options',
  'Tenant Evolution Switch Options',
  'Tenant user read of allowed Platform Evolution scope switch options for the signed-in user. Supports selecting scope_key for tenant evolution reads without granting new access or exposing secrets.',
  'GET',
  '/tenant/evolution/switch-options',
  NULL,
  '{"type":"object","properties":{"brand_key":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100,"default":50}},"additionalProperties":false}',
  NULL,
  'tenant,evolution,user-switch,switch-options,read_only,scope_gated,no_secrets',
  1,
  339
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
