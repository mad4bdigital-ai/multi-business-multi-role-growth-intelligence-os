-- Sprint 68: Platform Orchestration capability binding.
--
-- Registers platform_orchestration as a no-credential internal app/capability
-- surface so capability envelopes for orchestration readback/proposal/record
-- can resolve through governed app maps instead of blocked setup.
--
-- This is registry-only. It does not create provider connections, credentials,
-- external writes, spend changes, deploys, publishing, or secrets.

INSERT INTO `app_integrations` (
  `app_key`, `display_name`, `description`, `auth_type`, `category`,
  `default_action_grants`, `status`
) VALUES (
  'platform_orchestration',
  'Platform Orchestration',
  'Internal no-credential orchestration intelligence surface for graph readback, snapshot proposals, and gated snapshot/recommendation recording.',
  'mcp',
  'orchestration_intelligence',
  JSON_OBJECT('credential_source','none','provider_calls_allowed',false,'secrets_included',false),
  'active'
) ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `auth_type` = VALUES(`auth_type`),
  `category` = VALUES(`category`),
  `default_action_grants` = VALUES(`default_action_grants`),
  `status` = VALUES(`status`);

INSERT INTO `app_integration_action_bindings` (
  `binding_id`, `app_key`, `action_key`, `binding_role`, `credential_source`,
  `exposure_default`, `status`, `notes`
) VALUES
  ('bind_action_platform_orchestration_readback', 'platform_orchestration', 'platform_orchestration_readback', 'resolver', 'none', 'manual_tools', 'active', 'No-credential readback surface. Reads orchestration graph/snapshot/recommendation readiness only.'),
  ('bind_action_ads_governance_snapshot_propose', 'platform_orchestration', 'ads_provider_governance_snapshot_propose', 'resolver', 'none', 'manual_tools', 'active', 'No-credential proposal-only Ads Provider Governance snapshot/recommendation candidate surface.'),
  ('bind_action_ads_governance_snapshot_record', 'platform_orchestration', 'ads_provider_governance_snapshot_record', 'resolver', 'none', 'manual_tools', 'active', 'No-credential gated snapshot/recommendation record surface. Requires proposal hash, idempotency key, ready capability envelope, and apply=true before DB write.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `action_key` = VALUES(`action_key`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_default` = VALUES(`exposure_default`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings` (
  `binding_id`, `app_key`, `tool_key`, `tool_surface`, `binding_role`,
  `credential_source`, `exposure_scope`, `status`, `notes`
) VALUES
  ('bind_tool_platform_orchestration_readback', 'platform_orchestration', 'platform_orchestration_readback', 'admin_platform_tool', 'read_only', 'none', 'admin', 'active', 'Read-only orchestration graph/snapshot/recommendation readback tool.'),
  ('bind_tool_ads_governance_snapshot_propose', 'platform_orchestration', 'ads_provider_governance_snapshot_propose', 'admin_platform_tool', 'read_only', 'none', 'admin', 'active', 'Proposal-only Ads Provider Governance snapshot/recommendation candidate tool.'),
  ('bind_tool_ads_governance_snapshot_record', 'platform_orchestration', 'ads_provider_governance_snapshot_record', 'admin_platform_tool', 'state_changing', 'none', 'admin', 'active', 'Gated state-changing snapshot/recommendation record tool. No provider calls, credential payload reads, spend changes, or secrets.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `tool_key` = VALUES(`tool_key`),
  `tool_surface` = VALUES(`tool_surface`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_scope` = VALUES(`exposure_scope`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
