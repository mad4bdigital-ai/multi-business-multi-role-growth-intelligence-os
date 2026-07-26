-- Sprint 68: Activation tenant smoke positive permission fixture.
-- Creates a deterministic tenant/user fixture with a connector, installation, and permission grant
-- so tenant activation smoke covers grant-positive authorization, not only no-leakage.

INSERT INTO `tenants`
  (`tenant_id`, `tenant_type`, `display_name`, `status`, `metadata_json`)
VALUES
  ('00000000-0000-4000-a000-000000000099', 'managed_client_account', 'Activation Smoke Tenant', 'active',
   JSON_OBJECT('fixture', 'activation_authorized_access_tenant_smoke', 'secrets_included', false))
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `memberships`
  (`user_id`, `tenant_id`, `role`, `status`)
SELECT 'activation_smoke_user', '00000000-0000-4000-a000-000000000099', 'operator', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM `memberships`
   WHERE `user_id` = 'activation_smoke_user'
     AND `tenant_id` = '00000000-0000-4000-a000-000000000099'
     AND `role` = 'operator'
);

INSERT INTO `workspace_registry`
  (`workspace_id`, `tenant_id`, `workspace_key`, `display_name`, `workspace_type`, `bootstrap_status`, `linked_brand_key`, `linked_system_ids`, `config_json`, `created_by`)
VALUES
  ('00000000-0000-4000-a000-000000000095', '00000000-0000-4000-a000-000000000099', 'activation_smoke_workspace',
   'Activation Smoke Workspace', 'sandbox', 'ready', 'activation_smoke_brand', '00000000-0000-4000-a000-000000000098',
   JSON_OBJECT('fixture', 'activation_authorized_access_tenant_smoke', 'secrets_included', false), 'gpt_admin')
ON DUPLICATE KEY UPDATE
  `workspace_key` = VALUES(`workspace_key`),
  `display_name` = VALUES(`display_name`),
  `workspace_type` = VALUES(`workspace_type`),
  `bootstrap_status` = VALUES(`bootstrap_status`),
  `linked_brand_key` = VALUES(`linked_brand_key`),
  `linked_system_ids` = VALUES(`linked_system_ids`),
  `config_json` = VALUES(`config_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `connected_systems`
  (`system_id`, `tenant_id`, `system_key`, `display_name`, `provider_family`, `provider_domain`, `connector_family`,
   `auth_type`, `service_mode`, `self_serve_capable`, `assisted_capable`, `managed_capable`, `status`, `config_json`)
VALUES
  ('00000000-0000-4000-a000-000000000098', '00000000-0000-4000-a000-000000000099', 'activation_smoke_wordpress',
   'Activation Smoke WordPress', 'wordpress', 'example.invalid', 'http_generic_api_connector',
   'fixture', 'managed', 0, 0, 1, 'active',
   JSON_OBJECT('fixture', 'activation_authorized_access_tenant_smoke', 'credential_present', false, 'secrets_included', false))
ON DUPLICATE KEY UPDATE
  `tenant_id` = VALUES(`tenant_id`),
  `system_key` = VALUES(`system_key`),
  `display_name` = VALUES(`display_name`),
  `provider_family` = VALUES(`provider_family`),
  `provider_domain` = VALUES(`provider_domain`),
  `connector_family` = VALUES(`connector_family`),
  `auth_type` = VALUES(`auth_type`),
  `service_mode` = VALUES(`service_mode`),
  `self_serve_capable` = VALUES(`self_serve_capable`),
  `assisted_capable` = VALUES(`assisted_capable`),
  `managed_capable` = VALUES(`managed_capable`),
  `status` = VALUES(`status`),
  `config_json` = VALUES(`config_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `installations`
  (`installation_id`, `system_id`, `tenant_id`, `scope`, `credential_ref`, `status`, `meta_json`)
VALUES
  ('00000000-0000-4000-a000-000000000097', '00000000-0000-4000-a000-000000000098', '00000000-0000-4000-a000-000000000099',
   'wordpress_api', NULL, 'active', JSON_OBJECT('fixture', 'activation_authorized_access_tenant_smoke', 'secrets_included', false))
ON DUPLICATE KEY UPDATE
  `system_id` = VALUES(`system_id`),
  `tenant_id` = VALUES(`tenant_id`),
  `scope` = VALUES(`scope`),
  `credential_ref` = VALUES(`credential_ref`),
  `status` = VALUES(`status`),
  `meta_json` = VALUES(`meta_json`);

INSERT INTO `permission_grants`
  (`grant_id`, `installation_id`, `tenant_id`, `permission_key`, `granted`, `granted_by`)
VALUES
  ('00000000-0000-4000-a000-000000000096', '00000000-0000-4000-a000-000000000097', '00000000-0000-4000-a000-000000000099',
   'wordpress_api', 1, 'gpt_admin')
ON DUPLICATE KEY UPDATE
  `installation_id` = VALUES(`installation_id`),
  `tenant_id` = VALUES(`tenant_id`),
  `permission_key` = VALUES(`permission_key`),
  `granted` = VALUES(`granted`),
  `granted_by` = VALUES(`granted_by`),
  `granted_at` = CURRENT_TIMESTAMP;
