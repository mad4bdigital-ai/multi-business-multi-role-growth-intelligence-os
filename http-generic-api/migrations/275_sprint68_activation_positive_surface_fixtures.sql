-- Sprint 68: Activation positive surface fixtures.
-- Adds deterministic, non-secret fixture rows so tenant activation smoke covers
-- positive rows across granted/enabled activation surfaces, not only no-leakage.

INSERT INTO `agents`
  (`agent_id`, `name`, `display_name`, `description`, `execution_class`, `execution_layer`, `system_prompt`, `health_status`, `is_system`, `status`)
VALUES
  ('00000000-0000-4000-a000-000000000094', 'activation_smoke_agent', 'Activation Smoke Agent',
   'Fixture agent for activation authorized access smoke coverage.', 'standard', 'activation_smoke', NULL, 'active', 0, 'active')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `execution_class` = VALUES(`execution_class`),
  `execution_layer` = VALUES(`execution_layer`),
  `system_prompt` = VALUES(`system_prompt`),
  `health_status` = VALUES(`health_status`),
  `is_system` = VALUES(`is_system`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `agent_skills`
  (`skill_id`, `skill_key`, `display_name`, `description`, `skill_type`, `scope`, `capability_json`, `requires_approval`, `status`)
VALUES
  ('00000000-0000-4000-a000-000000000093', 'activation_smoke_skill', 'Activation Smoke Skill',
   'Fixture skill for activation authorized access smoke coverage.', 'logic_execution', 'tenant',
   JSON_OBJECT('fixture', 'activation_positive_surface_fixtures', 'secrets_included', false), 0, 'active')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `skill_type` = VALUES(`skill_type`),
  `scope` = VALUES(`scope`),
  `capability_json` = VALUES(`capability_json`),
  `requires_approval` = VALUES(`requires_approval`),
  `status` = VALUES(`status`);

INSERT INTO `agent_skill_grants`
  (`grant_id`, `agent_id`, `skill_id`, `tenant_id`, `brand_key`, `granted_by`, `status`)
VALUES
  ('00000000-0000-4000-a000-000000000092', '00000000-0000-4000-a000-000000000094', '00000000-0000-4000-a000-000000000093',
   '00000000-0000-4000-a000-000000000099', 'activation_smoke_brand', 'gpt_admin', 'active')
ON DUPLICATE KEY UPDATE
  `agent_id` = VALUES(`agent_id`),
  `skill_id` = VALUES(`skill_id`),
  `tenant_id` = VALUES(`tenant_id`),
  `brand_key` = VALUES(`brand_key`),
  `granted_by` = VALUES(`granted_by`),
  `expires_at` = NULL,
  `status` = VALUES(`status`);

INSERT INTO `app_integrations`
  (`app_key`, `display_name`, `description`, `auth_type`, `category`, `status`)
VALUES
  ('activation_smoke_app', 'Activation Smoke App', 'Fixture app integration for activation smoke coverage.', 'api_key', 'fixture', 'active')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `auth_type` = VALUES(`auth_type`),
  `category` = VALUES(`category`),
  `status` = VALUES(`status`);

INSERT INTO `user_app_connections`
  (`connection_id`, `user_id`, `tenant_id`, `app_key`, `display_label`, `auth_type`,
   `encrypted_credentials`, `credential_ref`, `scopes_granted`, `account_label`, `account_metadata`,
   `is_primary`, `status`, `validation_status`, `last_validated_at`, `last_used_at`)
VALUES
  ('00000000-0000-4000-a000-000000000091', 'activation_smoke_user', '00000000-0000-4000-a000-000000000099',
   'activation_smoke_app', 'Activation Smoke App Connection', 'api_key',
   NULL, NULL, 'activation_smoke.read activation_smoke.write', 'activation-smoke-account',
   JSON_OBJECT('fixture', 'activation_positive_surface_fixtures', 'secrets_included', false),
   1, 'active', 'validated', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `user_id` = VALUES(`user_id`),
  `tenant_id` = VALUES(`tenant_id`),
  `app_key` = VALUES(`app_key`),
  `display_label` = VALUES(`display_label`),
  `auth_type` = VALUES(`auth_type`),
  `encrypted_credentials` = NULL,
  `credential_ref` = NULL,
  `scopes_granted` = VALUES(`scopes_granted`),
  `account_label` = VALUES(`account_label`),
  `account_metadata` = VALUES(`account_metadata`),
  `is_primary` = VALUES(`is_primary`),
  `status` = VALUES(`status`),
  `validation_status` = VALUES(`validation_status`),
  `last_validated_at` = VALUES(`last_validated_at`),
  `last_used_at` = VALUES(`last_used_at`);

INSERT INTO `app_action_grants`
  (`grant_id`, `connection_id`, `workspace_id`, `agent_id`, `app_key`, `action_key`, `grant_mode`, `granted_by`, `expires_at`, `status`)
VALUES
  ('00000000-0000-4000-a000-000000000090', '00000000-0000-4000-a000-000000000091', '00000000-0000-4000-a000-000000000095',
   '00000000-0000-4000-a000-000000000094', 'activation_smoke_app', 'activation_smoke_app.execute', 'explicit', 'gpt_admin', NULL, 'active')
ON DUPLICATE KEY UPDATE
  `connection_id` = VALUES(`connection_id`),
  `workspace_id` = VALUES(`workspace_id`),
  `agent_id` = VALUES(`agent_id`),
  `app_key` = VALUES(`app_key`),
  `action_key` = VALUES(`action_key`),
  `grant_mode` = VALUES(`grant_mode`),
  `granted_by` = VALUES(`granted_by`),
  `expires_at` = NULL,
  `status` = VALUES(`status`);

INSERT INTO `workflows`
  (`workflow_id`, `workflow_key`, `workflow_name`, `workflow_type`, `route_key`, `execution_mode`,
   `target_module`, `priority`, `user_facing`, `active`, `status`, `execution_class`, `lifecycle_mode`,
   `memory_required`, `logging_required`, `review_required`, `client_allowed`, `team_allowed`, `admin_only`, `brand_scope_enforced`)
VALUES
  ('00000000-0000-4000-a000-000000000089', 'activation_smoke_workflow', 'Activation Smoke Workflow', 'fixture',
   'activation_smoke_route', 'sync', 'activation_smoke', 'low', 'TRUE', 'TRUE', 'active', 'fixture', 'active',
   'FALSE', 'TRUE', 'FALSE', 'TRUE', 'TRUE', 'FALSE', 'FALSE')
ON DUPLICATE KEY UPDATE
  `workflow_key` = VALUES(`workflow_key`),
  `workflow_name` = VALUES(`workflow_name`),
  `workflow_type` = VALUES(`workflow_type`),
  `route_key` = VALUES(`route_key`),
  `execution_mode` = VALUES(`execution_mode`),
  `target_module` = VALUES(`target_module`),
  `priority` = VALUES(`priority`),
  `user_facing` = VALUES(`user_facing`),
  `active` = VALUES(`active`),
  `status` = VALUES(`status`),
  `execution_class` = VALUES(`execution_class`),
  `lifecycle_mode` = VALUES(`lifecycle_mode`),
  `memory_required` = VALUES(`memory_required`),
  `logging_required` = VALUES(`logging_required`),
  `review_required` = VALUES(`review_required`),
  `client_allowed` = VALUES(`client_allowed`),
  `team_allowed` = VALUES(`team_allowed`),
  `admin_only` = VALUES(`admin_only`),
  `brand_scope_enforced` = VALUES(`brand_scope_enforced`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `workflow_runtime_bindings`
  (`binding_key`, `workflow_key`, `runtime_type`, `task_class`, `tenant_id`, `n8n_workflow_id`, `n8n_webhook_path`, `n8n_webhook_url`,
   `execution_mode`, `auth_mode`, `credential_env_var`, `input_schema_json`, `output_schema_json`, `timeout_ms`, `status`, `metadata_json`)
VALUES
  ('activation_smoke_workflow_binding', 'activation_smoke_workflow', 'js', 'activation_smoke', '00000000-0000-4000-a000-000000000099',
   NULL, NULL, NULL, 'sync', 'none', NULL, NULL, NULL, 30000, 'active',
   JSON_OBJECT('fixture', 'activation_positive_surface_fixtures', 'secrets_included', false))
ON DUPLICATE KEY UPDATE
  `workflow_key` = VALUES(`workflow_key`),
  `runtime_type` = VALUES(`runtime_type`),
  `task_class` = VALUES(`task_class`),
  `tenant_id` = VALUES(`tenant_id`),
  `n8n_workflow_id` = NULL,
  `n8n_webhook_path` = NULL,
  `n8n_webhook_url` = NULL,
  `execution_mode` = VALUES(`execution_mode`),
  `auth_mode` = VALUES(`auth_mode`),
  `credential_env_var` = NULL,
  `input_schema_json` = NULL,
  `output_schema_json` = NULL,
  `timeout_ms` = VALUES(`timeout_ms`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_contributions`
  (`contribution_id`, `plugin_key`, `display_name`, `plugin_type`, `owner_scope`, `owner_tenant_id`, `owner_user_id`,
   `target`, `base_plugin_key`, `status`, `certification_status`, `private_execution_enabled`, `private_activated_at`,
   `manifest_json`, `protocol_bindings_json`, `action_bindings_json`, `credential_policy_json`, `validation_report_json`,
   `notes`, `created_by`, `updated_by`, `submitted_at`)
VALUES
  ('activation_smoke_plugin_contribution', 'activation.smoke.plugin', 'Activation Smoke Plugin', 'rest_api', 'tenant',
   '00000000-0000-4000-a000-000000000099', 'activation_smoke_user', 'tenant_private', NULL,
   'certified', 'certified', 1, UTC_TIMESTAMP(), NULL, NULL, NULL, NULL,
   JSON_OBJECT('fixture', 'activation_positive_surface_fixtures', 'secrets_included', false),
   'Fixture plugin contribution for activation smoke coverage.', 'gpt_admin', 'gpt_admin', UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `plugin_key` = VALUES(`plugin_key`),
  `display_name` = VALUES(`display_name`),
  `plugin_type` = VALUES(`plugin_type`),
  `owner_scope` = VALUES(`owner_scope`),
  `owner_tenant_id` = VALUES(`owner_tenant_id`),
  `owner_user_id` = VALUES(`owner_user_id`),
  `target` = VALUES(`target`),
  `status` = VALUES(`status`),
  `certification_status` = VALUES(`certification_status`),
  `private_execution_enabled` = VALUES(`private_execution_enabled`),
  `private_activated_at` = VALUES(`private_activated_at`),
  `manifest_json` = NULL,
  `protocol_bindings_json` = NULL,
  `action_bindings_json` = NULL,
  `credential_policy_json` = NULL,
  `validation_report_json` = VALUES(`validation_report_json`),
  `notes` = VALUES(`notes`),
  `updated_by` = VALUES(`updated_by`),
  `submitted_at` = VALUES(`submitted_at`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_pending_tasks`
  (`task_id`, `task_key`, `title`, `description`, `brief`, `activation_prompt`, `task_type`, `priority`, `status`, `blocker_level`,
   `owner_scope`, `tenant_id`, `user_id`, `source_surface`, `source_ref`, `conversation_context_ref`, `activation_visibility`,
   `show_until_status_json`, `context_json`, `created_by`, `updated_by`, `due_at`)
VALUES
  ('00000000-0000-4000-a000-000000000088', 'activation_smoke_positive_fixture_task', 'Activation smoke positive fixture task',
   'Fixture task for activation authorized access smoke coverage.', 'Fixture task for activation smoke.', NULL,
   'certification', 'low', 'pending', 'none', 'tenant', '00000000-0000-4000-a000-000000000099', 'activation_smoke_user',
   'activation_positive_surface_fixtures', 'activation_smoke_fixture', NULL, 1,
   JSON_ARRAY('pending','in_progress','blocked'), JSON_OBJECT('fixture', 'activation_positive_surface_fixtures', 'secrets_included', false),
   'gpt_admin', 'gpt_admin', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `description` = VALUES(`description`),
  `brief` = VALUES(`brief`),
  `activation_prompt` = NULL,
  `task_type` = VALUES(`task_type`),
  `priority` = VALUES(`priority`),
  `status` = VALUES(`status`),
  `blocker_level` = VALUES(`blocker_level`),
  `owner_scope` = VALUES(`owner_scope`),
  `tenant_id` = VALUES(`tenant_id`),
  `user_id` = VALUES(`user_id`),
  `source_surface` = VALUES(`source_surface`),
  `source_ref` = VALUES(`source_ref`),
  `conversation_context_ref` = NULL,
  `activation_visibility` = VALUES(`activation_visibility`),
  `show_until_status_json` = VALUES(`show_until_status_json`),
  `context_json` = VALUES(`context_json`),
  `updated_by` = VALUES(`updated_by`),
  `due_at` = VALUES(`due_at`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `tenant_integration_policies`
  (`tenant_id`, `app_key`, `source_mode`, `fallback_allowed`, `required_for_device_install`, `notes`, `status`, `source`, `created_by`, `updated_by`)
VALUES
  ('00000000-0000-4000-a000-000000000099', 'activation_smoke_app', 'managed', 1, 0,
   'Fixture integration policy for activation smoke coverage.', 'active', 'activation_positive_surface_fixtures', 'gpt_admin', 'gpt_admin')
ON DUPLICATE KEY UPDATE
  `source_mode` = VALUES(`source_mode`),
  `fallback_allowed` = VALUES(`fallback_allowed`),
  `required_for_device_install` = VALUES(`required_for_device_install`),
  `notes` = VALUES(`notes`),
  `status` = VALUES(`status`),
  `source` = VALUES(`source`),
  `updated_by` = VALUES(`updated_by`),
  `updated_at` = CURRENT_TIMESTAMP;
