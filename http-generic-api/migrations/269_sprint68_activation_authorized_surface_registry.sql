-- Sprint 68: Activation authorized surface registry foundation.
-- Registry-driven activation surfaces so future authorized layers can appear in activation without route changes.

CREATE TABLE IF NOT EXISTS `activation_authorized_surface_registry` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `surface_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `source_table` VARCHAR(128) NOT NULL,
  `result_key_column` VARCHAR(128) NULL,
  `result_label_column` VARCHAR(128) NULL,
  `tenant_column` VARCHAR(128) NULL,
  `user_column` VARCHAR(128) NULL,
  `status_column` VARCHAR(128) NULL,
  `active_status_values_json` LONGTEXT NULL CHECK (JSON_VALID(`active_status_values_json`)),
  `result_columns_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`result_columns_json`)),
  `include_for_admin` TINYINT(1) NOT NULL DEFAULT 1,
  `include_for_tenant` TINYINT(1) NOT NULL DEFAULT 1,
  `max_rows` INT NOT NULL DEFAULT 25,
  `sort_order` INT NOT NULL DEFAULT 100,
  `status` ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_activation_authorized_surface_key` (`surface_key`),
  KEY `idx_activation_authorized_surface_status` (`status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `activation_authorized_surface_registry`
  (`surface_key`, `display_name`, `description`, `source_table`, `result_key_column`, `result_label_column`,
   `tenant_column`, `user_column`, `status_column`, `active_status_values_json`, `result_columns_json`,
   `include_for_admin`, `include_for_tenant`, `max_rows`, `sort_order`, `status`, `notes`)
VALUES
  ('workspace_registry', 'Authorized Workspaces', 'Tenant-scoped workspaces visible during activation.', 'workspace_registry', 'workspace_key', 'display_name',
   'tenant_id', NULL, 'bootstrap_status', JSON_ARRAY('ready','in_progress','degraded'),
   JSON_ARRAY('workspace_id','tenant_id','workspace_key','display_name','workspace_type','bootstrap_status','linked_brand_key','linked_system_ids'),
   1, 1, 25, 10, 'active', 'Seeded activation surface. No credential fields.'),
  ('connected_systems', 'Authorized Connected Systems', 'Tenant-scoped connected systems visible during activation.', 'connected_systems', 'system_key', 'display_name',
   'tenant_id', NULL, 'status', JSON_ARRAY('active','pending','error'),
   JSON_ARRAY('system_id','tenant_id','system_key','display_name','provider_family','connector_family','auth_type','service_mode','status'),
   1, 1, 25, 20, 'active', 'Seeded activation surface. Excludes config_json and secret refs.'),
  ('installations', 'Authorized Installations', 'Tenant-scoped active installations visible during activation.', 'installations', 'installation_id', 'scope',
   'tenant_id', NULL, 'status', JSON_ARRAY('active'),
   JSON_ARRAY('installation_id','system_id','tenant_id','scope','status','expires_at'),
   1, 1, 25, 30, 'active', 'Seeded activation surface. Excludes credential_ref.'),
  ('permission_grants', 'Authorized Permission Grants', 'Tenant-scoped granted permission keys visible during activation.', 'permission_grants', 'permission_key', 'permission_key',
   'tenant_id', NULL, 'granted', JSON_ARRAY('1'),
   JSON_ARRAY('permission_key','tenant_id','installation_id','granted','granted_at'),
   1, 1, 50, 40, 'active', 'Seeded activation surface. Permission keys only; no secrets.')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `source_table` = VALUES(`source_table`),
  `result_key_column` = VALUES(`result_key_column`),
  `result_label_column` = VALUES(`result_label_column`),
  `tenant_column` = VALUES(`tenant_column`),
  `user_column` = VALUES(`user_column`),
  `status_column` = VALUES(`status_column`),
  `active_status_values_json` = VALUES(`active_status_values_json`),
  `result_columns_json` = VALUES(`result_columns_json`),
  `include_for_admin` = VALUES(`include_for_admin`),
  `include_for_tenant` = VALUES(`include_for_tenant`),
  `max_rows` = VALUES(`max_rows`),
  `sort_order` = VALUES(`sort_order`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_activation_authorized_surface_registry_readiness` AS
SELECT
  'activation_authorized_surface_registry' AS readiness_key,
  CASE
    WHEN SUM(CASE WHEN JSON_VALID(`result_columns_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `status` = 'active' THEN 1 ELSE 0 END) = 0 THEN 'warn'
    ELSE 'pass'
  END AS readiness_status,
  COUNT(*) AS registered_surface_count,
  SUM(CASE WHEN `status` = 'active' THEN 1 ELSE 0 END) AS active_surface_count,
  SUM(CASE WHEN `include_for_tenant` = 1 THEN 1 ELSE 0 END) AS tenant_visible_surface_count,
  SUM(CASE WHEN `include_for_admin` = 1 THEN 1 ELSE 0 END) AS admin_visible_surface_count,
  SUM(CASE WHEN JSON_VALID(`result_columns_json`) = 0 THEN 1 ELSE 0 END) AS invalid_result_column_rows,
  0 AS secrets_included
FROM `activation_authorized_surface_registry`;
