-- Sprint 68: Dynamic memory scope types foundation.
-- Replaces the closed json_asset_subject_links.subject_type enum with a governed VARCHAR scope key.
-- New memory/feed scopes are added as registry data rather than ALTERing an enum.

CREATE TABLE IF NOT EXISTS `memory_scope_type_registry` (
  `scope_type` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `scope_layer` ENUM('platform','tenant','user','workspace','brand','activity','role','runtime','resource','governance','knowledge','conversation') NOT NULL DEFAULT 'platform',
  `identity_table` VARCHAR(128) NULL,
  `identity_key_column` VARCHAR(128) NULL,
  `parent_scope_type` VARCHAR(64) NULL,
  `supports_tenant_id` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_user_id` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_workspace_key` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_brand_key` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_activity_type_key` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_role_key` TINYINT(1) NOT NULL DEFAULT 0,
  `default_visibility_scope` VARCHAR(64) NOT NULL DEFAULT 'platform_admin',
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL CHECK (JSON_VALID(`metadata_json`) OR `metadata_json` IS NULL),
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope_type`),
  KEY `idx_memory_scope_layer_status` (`scope_layer`, `status`),
  KEY `idx_memory_scope_parent` (`parent_scope_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `memory_scope_type_registry`
  (`scope_type`, `display_name`, `description`, `scope_layer`, `identity_table`, `identity_key_column`, `parent_scope_type`,
   `supports_tenant_id`, `supports_user_id`, `supports_workspace_key`, `supports_brand_key`, `supports_activity_type_key`, `supports_role_key`,
   `default_visibility_scope`, `approval_required`, `metadata_json`)
VALUES
  ('platform', 'Platform', 'Global platform-owned memory and governance scope.', 'platform', NULL, NULL, NULL, 0,0,0,0,0,0, 'platform_admin', 1, JSON_OBJECT('legacy_enum_value', true)),
  ('tenant', 'Tenant', 'Tenant-scoped memory and operating rules.', 'tenant', 'tenants', 'tenant_id', 'platform', 1,0,0,0,0,0, 'tenant_admin', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('user', 'User', 'User-scoped memory and preferences.', 'user', 'users', 'user_id', 'tenant', 1,1,0,0,0,0, 'user_private', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('device', 'Device', 'Local or remote device scope.', 'resource', 'local_connector_user_configs', 'device_id', 'user', 1,1,0,0,0,0, 'user_private', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('brand', 'Brand', 'Brand-scoped memory, instructions, and assets.', 'brand', 'brands', 'target_key', 'tenant', 1,0,1,1,0,0, 'workspace_team', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('workflow', 'Workflow', 'Workflow-scoped memory and execution guidance.', 'runtime', 'workflows', 'workflow_key', 'platform', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('legacy_enum_value', true)),
  ('module', 'Module', 'Module-scoped memory and implementation guidance.', 'runtime', NULL, NULL, 'platform', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('legacy_enum_value', true)),
  ('conversation', 'Conversation', 'Conversation/session summary memory scope.', 'conversation', 'customer_sessions', 'session_id', 'user', 1,1,1,1,0,1, 'user_private', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('execution_trace', 'Execution Trace', 'Execution trace and audit evidence scope.', 'runtime', 'execution_log', 'execution_trace_id_writeback', 'conversation', 1,1,1,1,1,1, 'tenant_admin', 0, JSON_OBJECT('legacy_enum_value', true)),
  ('workspace', 'Workspace', 'Workspace-scoped memory, process rules, and assets.', 'workspace', 'workspace_registry', 'workspace_key', 'tenant', 1,0,1,0,0,0, 'workspace_team', 0, JSON_OBJECT('dynamic_scope', true)),
  ('business_activity_type', 'Business Activity Type', 'Activity-scoped knowledge, patterns, and runtime routing guidance.', 'activity', 'business_activity_types', 'business_activity_type_key', 'platform', 0,0,1,1,1,1, 'workspace_team', 0, JSON_OBJECT('dynamic_scope', true)),
  ('activity_type', 'Activity Type Alias', 'Alias for business_activity_type used by lightweight callers.', 'activity', 'business_activity_types', 'activity_key', 'business_activity_type', 0,0,1,1,1,1, 'workspace_team', 0, JSON_OBJECT('alias_for', 'business_activity_type')),
  ('role', 'Role', 'Role-scoped memory and instructions.', 'role', 'assistance_roles', 'role_key', 'tenant', 1,1,1,1,1,1, 'workspace_team', 0, JSON_OBJECT('dynamic_scope', true)),
  ('assistance_role', 'Assistance Role', 'Alias for role scoped to assistance_roles.', 'role', 'assistance_roles', 'role_key', 'role', 1,1,1,1,1,1, 'workspace_team', 0, JSON_OBJECT('alias_for', 'role')),
  ('policy', 'Policy', 'Policy-scoped memory and promotion candidates.', 'governance', 'execution_policies', 'policy_key', 'platform', 0,0,0,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('logic', 'Logic', 'Logic-definition scoped memory and repair guidance.', 'runtime', 'logic_definitions', 'logic_key', 'tenant', 1,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('logic_pack', 'Logic Pack', 'Logic-pack scoped memory and compatibility guidance.', 'runtime', 'logic_packs', 'pack_key', 'tenant', 1,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('engine', 'Engine', 'Intelligence-engine scoped memory and runtime policy guidance.', 'runtime', 'platform_engine_registry', 'engine_key', 'platform', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('plugin', 'Plugin', 'Plugin-scoped memory and integration guidance.', 'resource', 'plugins', 'plugin_key', 'brand', 1,0,1,1,1,0, 'workspace_team', 0, JSON_OBJECT('dynamic_scope', true)),
  ('task_route', 'Task Route', 'Task-route scoped memory and routing improvements.', 'runtime', 'task_routes', 'task_key', 'platform', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('action', 'Action', 'Action/tool scoped memory and operational guidance.', 'runtime', 'actions', 'action_key', 'platform', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('endpoint', 'Endpoint', 'Endpoint/API route scoped memory and contract guidance.', 'runtime', 'endpoints', 'endpoint_key', 'action', 0,0,1,1,1,1, 'platform_admin', 1, JSON_OBJECT('dynamic_scope', true)),
  ('knowledge_profile', 'Knowledge Profile', 'Knowledge profile scoped memory for activities and business types.', 'knowledge', 'business_type_profiles', 'profile_key', 'business_activity_type', 0,0,1,1,1,1, 'workspace_team', 0, JSON_OBJECT('dynamic_scope', true)),
  ('resource', 'Resource', 'Generic resource scope for future extensibility.', 'resource', NULL, NULL, 'tenant', 1,1,1,1,1,1, 'tenant_admin', 0, JSON_OBJECT('dynamic_scope', true))
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `scope_layer` = VALUES(`scope_layer`),
  `identity_table` = VALUES(`identity_table`),
  `identity_key_column` = VALUES(`identity_key_column`),
  `parent_scope_type` = VALUES(`parent_scope_type`),
  `supports_tenant_id` = VALUES(`supports_tenant_id`),
  `supports_user_id` = VALUES(`supports_user_id`),
  `supports_workspace_key` = VALUES(`supports_workspace_key`),
  `supports_brand_key` = VALUES(`supports_brand_key`),
  `supports_activity_type_key` = VALUES(`supports_activity_type_key`),
  `supports_role_key` = VALUES(`supports_role_key`),
  `default_visibility_scope` = VALUES(`default_visibility_scope`),
  `approval_required` = VALUES(`approval_required`),
  `metadata_json` = VALUES(`metadata_json`),
  `status` = 'active',
  `updated_at` = CURRENT_TIMESTAMP;

ALTER TABLE `json_asset_subject_links`
  MODIFY COLUMN `subject_type` VARCHAR(64) NOT NULL;

ALTER TABLE `json_asset_subject_links`
  ADD COLUMN IF NOT EXISTS `scope_registry_status` ENUM('registered','unregistered','legacy_unchecked') NOT NULL DEFAULT 'legacy_unchecked' AFTER `scope_label`;

UPDATE `json_asset_subject_links` l
LEFT JOIN `memory_scope_type_registry` r ON r.scope_type = l.subject_type
SET l.scope_registry_status = CASE WHEN r.scope_type IS NULL THEN 'unregistered' ELSE 'registered' END;
