-- Registry-driven data management foundation.
-- Additive only: allowlisted Admin/Tenant row management. No destructive SQL, no secrets.

CREATE TABLE IF NOT EXISTS `platform_data_table_registry` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `table_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `physical_table_name` VARCHAR(191) NOT NULL,
  `scope_mode` ENUM('platform','tenant','workspace') NOT NULL DEFAULT 'tenant',
  `tenant_column` VARCHAR(191) NULL,
  `workspace_column` VARCHAR(191) NULL,
  `primary_key_columns_json` LONGTEXT NOT NULL,
  `readable_columns_json` LONGTEXT NOT NULL,
  `writable_columns_json` LONGTEXT NOT NULL,
  `creatable_columns_json` LONGTEXT NOT NULL,
  `patchable_columns_json` LONGTEXT NOT NULL,
  `filterable_columns_json` LONGTEXT NULL,
  `required_create_columns_json` LONGTEXT NULL,
  `json_columns_json` LONGTEXT NULL,
  `default_values_json` LONGTEXT NULL,
  `allowed_operations_json` LONGTEXT NOT NULL,
  `enabled_surfaces_json` LONGTEXT NOT NULL,
  `soft_delete_column` VARCHAR(191) NULL,
  `soft_delete_value` VARCHAR(191) NULL,
  `max_limit` INT NOT NULL DEFAULT 100,
  `sort_order` INT NOT NULL DEFAULT 100,
  `status` ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_platform_data_table_registry_key` (`table_key`),
  KEY `idx_platform_data_table_registry_status` (`status`),
  KEY `idx_platform_data_table_registry_scope` (`scope_mode`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_data_table_registry` (
  `table_key`, `display_name`, `description`, `physical_table_name`, `scope_mode`,
  `tenant_column`, `workspace_column`, `primary_key_columns_json`, `readable_columns_json`,
  `writable_columns_json`, `creatable_columns_json`, `patchable_columns_json`,
  `filterable_columns_json`, `required_create_columns_json`, `json_columns_json`,
  `default_values_json`, `allowed_operations_json`, `enabled_surfaces_json`,
  `soft_delete_column`, `soft_delete_value`, `max_limit`, `sort_order`, `status`, `metadata_json`
)
VALUES
(
  'business_activity_types','Business Activity Types',
  'Admin-managed business activity type registry.',
  'business_activity_types','platform',NULL,NULL,
  JSON_ARRAY('business_activity_type_key'),
  JSON_ARRAY('business_activity_type_key','activity_key','business_type_key','label','parent_activity_type','default_knowledge_profile_key','supported_engine_categories','supported_route_keys','supported_workflows','brand_core_required','status','notes','active','created_at','updated_at'),
  JSON_ARRAY('business_activity_type_key','activity_key','business_type_key','label','parent_activity_type','default_knowledge_profile_key','supported_engine_categories','supported_route_keys','supported_workflows','brand_core_required','status','notes','active'),
  JSON_ARRAY('business_activity_type_key','activity_key','business_type_key','label','parent_activity_type','default_knowledge_profile_key','supported_engine_categories','supported_route_keys','supported_workflows','brand_core_required','status','notes','active'),
  JSON_ARRAY('activity_key','business_type_key','label','parent_activity_type','default_knowledge_profile_key','supported_engine_categories','supported_route_keys','supported_workflows','brand_core_required','status','notes','active'),
  JSON_ARRAY('business_activity_type_key','activity_key','business_type_key','active','status'),
  JSON_ARRAY('business_activity_type_key','label'),JSON_ARRAY(),
  JSON_OBJECT('active','TRUE','status','active'),
  JSON_ARRAY('list','read','create','patch','archive'),JSON_ARRAY('admin'),
  'active','FALSE',200,10,'active',JSON_OBJECT('bootstrap','registry_data_management_v1','secret_columns_allowed',FALSE)
),
(
  'workspace_assets','Workspace Assets',
  'Tenant-scoped workspace asset references. Generic surface manages metadata rows only and never exposes file content.',
  'workspace_assets','tenant','tenant_id',NULL,
  JSON_ARRAY('asset_id'),
  JSON_ARRAY('asset_id','tenant_id','vault_id','asset_type','asset_ref','display_name','brand_ref','site_ref','workflow_ref','session_ref','visibility','lifecycle_status','metadata_json','created_by','created_at','updated_at'),
  JSON_ARRAY('asset_id','tenant_id','vault_id','asset_type','asset_ref','display_name','brand_ref','site_ref','workflow_ref','session_ref','visibility','lifecycle_status','metadata_json','created_by'),
  JSON_ARRAY('asset_id','tenant_id','vault_id','asset_type','asset_ref','display_name','brand_ref','site_ref','workflow_ref','session_ref','visibility','lifecycle_status','metadata_json','created_by'),
  JSON_ARRAY('vault_id','asset_type','asset_ref','display_name','brand_ref','site_ref','workflow_ref','session_ref','visibility','lifecycle_status','metadata_json'),
  JSON_ARRAY('asset_type','brand_ref','site_ref','workflow_ref','session_ref','visibility','lifecycle_status'),
  JSON_ARRAY('asset_type','asset_ref'),JSON_ARRAY('metadata_json'),
  JSON_OBJECT('asset_id','$uuid','tenant_id','$tenant_id','created_by','$user_id','visibility','workspace','lifecycle_status','active'),
  JSON_ARRAY('list','read','create','patch','archive'),JSON_ARRAY('admin','tenant'),
  'lifecycle_status','archived',100,20,'active',JSON_OBJECT('bootstrap','registry_data_management_v1','tenant_scope_enforced',TRUE,'content_access',FALSE)
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),`description`=VALUES(`description`),`physical_table_name`=VALUES(`physical_table_name`),`scope_mode`=VALUES(`scope_mode`),`tenant_column`=VALUES(`tenant_column`),`workspace_column`=VALUES(`workspace_column`),`primary_key_columns_json`=VALUES(`primary_key_columns_json`),`readable_columns_json`=VALUES(`readable_columns_json`),`writable_columns_json`=VALUES(`writable_columns_json`),`creatable_columns_json`=VALUES(`creatable_columns_json`),`patchable_columns_json`=VALUES(`patchable_columns_json`),`filterable_columns_json`=VALUES(`filterable_columns_json`),`required_create_columns_json`=VALUES(`required_create_columns_json`),`json_columns_json`=VALUES(`json_columns_json`),`default_values_json`=VALUES(`default_values_json`),`allowed_operations_json`=VALUES(`allowed_operations_json`),`enabled_surfaces_json`=VALUES(`enabled_surfaces_json`),`soft_delete_column`=VALUES(`soft_delete_column`),`soft_delete_value`=VALUES(`soft_delete_value`),`max_limit`=VALUES(`max_limit`),`sort_order`=VALUES(`sort_order`),`status`=VALUES(`status`),`metadata_json`=VALUES(`metadata_json`),`updated_at`=CURRENT_TIMESTAMP;
