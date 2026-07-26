-- Sprint 64: owner-scoped private runtime for unpromoted Platform Plugin contributions.
-- Private activation lets the owner execute/resolve their own contributed plugin without promotion.
-- Promotion to Platform Base remains a separate admin certification path.

ALTER TABLE `platform_plugin_contributions`
  ADD COLUMN IF NOT EXISTS `private_execution_enabled` tinyint(1) NOT NULL DEFAULT 0 AFTER `certification_status`,
  ADD COLUMN IF NOT EXISTS `private_activated_at` datetime NULL AFTER `private_execution_enabled`;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_contribution_private_activate',
  'Activate Private Platform Plugin Contribution',
  'Enable owner-scoped private runtime for a tenant/user Platform Plugin contribution without promoting it to Platform Base.',
  'POST',
  '/platform/plugins/contributions/activate-private',
  NULL,
  '{"type":"object","required":["contribution_id"],"properties":{"contribution_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"notes":{"type":"string","maxLength":1000}}}',
  NULL,
  'admin,platform-plugin,contribution,state_changing,audited,no_secrets,owner_scoped,private_runtime',
  1,
  128
),
(
  'platform_plugin_contribution_private_resolve',
  'Resolve Private Platform Plugin Contribution',
  'Resolve whether an unpromoted Platform Plugin contribution can execute within its tenant/user owner scope. Does not promote or expose secrets.',
  'POST',
  '/platform/plugins/contributions/resolve-private',
  NULL,
  '{"type":"object","properties":{"contribution_id":{"type":"string"},"plugin_key":{"type":"string"},"action_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"requested_credential_scope":{"type":"string"}}}',
  NULL,
  'admin,platform-plugin,contribution,read_only,diagnostics,no_secrets,owner_scoped,private_runtime',
  1,
  129
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
