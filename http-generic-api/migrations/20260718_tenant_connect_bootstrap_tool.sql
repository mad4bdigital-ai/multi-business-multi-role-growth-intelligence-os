-- Register the Tenant GPT managed onboarding bootstrap tool.
-- Idempotent registry upsert; identity and tenant context are derived from the user JWT.

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'connect_bootstrap',
    'Bootstrap Tenant Connection',
    'Idempotently ensure the signed-in user has one eligible workspace, activate Managed mode, and verify final connection readback without leaving Tenant GPT.',
    'POST',
    '/connect/bootstrap',
    NULL,
    '{"type":"object","additionalProperties":false,"properties":{"mode":{"type":"string","enum":["managed"],"default":"managed"},"workspace_name":{"type":"string","maxLength":120},"display_name":{"type":"string","maxLength":120}}}',
    NULL,
    'tenant,connect,onboarding,state_changing,tenant_optional,managed,idempotent,approval_required,readback,same_cycle_readback,audited,no_secrets',
    1,
    39
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
