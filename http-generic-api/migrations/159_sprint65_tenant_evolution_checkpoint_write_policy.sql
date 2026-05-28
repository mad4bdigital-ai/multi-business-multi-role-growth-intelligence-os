-- Sprint 65: Tenant Evolution checkpoint write policy v1.
-- Adds a tenant-facing checkpoint create tool that is scoped, role-gated, and cannot set platform commit/deploy authority fields.

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_evolution_checkpoint_create',
  'Tenant Evolution Checkpoint Create',
  'Create a tenant/user scoped Platform Evolution checkpoint inside an allowed scope. Requires User JWT, active tenant membership, allowed v_platform_evolution_scope_access row, and owner/admin/manager/editor/operator or brand_owner role. Platform commit/deploy fields are ignored.',
  'POST',
  '/tenant/evolution/checkpoints',
  NULL,
  '{"type":"object","required":["summary_text"],"properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"checkpoint_id":{"type":"string"},"checkpoint_type":{"type":"string","enum":["operation","manual","rollup"],"default":"operation"},"summary_text":{"type":"string","maxLength":4000},"thread_snapshot":{"type":"object"},"delta":{"type":"object"},"evidence":{"type":"object"},"next_actions":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}',
  NULL,
  'tenant,evolution,checkpoint,write,role_gated,scope_gated,user_jwt,no_secrets,no_token_returned,no_platform_commit_authority',
  1,
  343
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
