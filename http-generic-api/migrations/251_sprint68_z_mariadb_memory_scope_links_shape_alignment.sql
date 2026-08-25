-- Staging-local compatibility alignment for the legacy memory_scope_links table created by migration 245.
-- Migration 252 is historical and intentionally remains immutable; this additive bridge makes
-- CREATE OR REPLACE VIEW v_memory_scope_link_registry_issues and later monitoring views valid.

ALTER TABLE `memory_scope_links`
  ADD COLUMN IF NOT EXISTS `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST,
  ADD COLUMN IF NOT EXISTS `resource_type` VARCHAR(64) NULL AFTER `link_id`,
  ADD COLUMN IF NOT EXISTS `resource_ref` VARCHAR(255) NULL AFTER `resource_type`,
  ADD COLUMN IF NOT EXISTS `resource_table` VARCHAR(128) NULL AFTER `resource_ref`,
  ADD COLUMN IF NOT EXISTS `resource_pk` VARCHAR(255) NULL AFTER `resource_table`,
  ADD COLUMN IF NOT EXISTS `asset_id` VARCHAR(255) NULL AFTER `resource_pk`,
  ADD COLUMN IF NOT EXISTS `asset_key` VARCHAR(255) NULL AFTER `asset_id`,
  ADD COLUMN IF NOT EXISTS `scope_type` VARCHAR(64) NULL AFTER `asset_key`,
  ADD COLUMN IF NOT EXISTS `scope_ref` VARCHAR(255) NULL AFTER `scope_type`,
  ADD COLUMN IF NOT EXISTS `scope_key` VARCHAR(255) NULL AFTER `scope_ref`,
  ADD COLUMN IF NOT EXISTS `user_id` VARCHAR(255) NULL AFTER `tenant_id`,
  ADD COLUMN IF NOT EXISTS `workspace_key` VARCHAR(128) NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `brand_key` VARCHAR(255) NULL AFTER `workspace_key`,
  ADD COLUMN IF NOT EXISTS `activity_type_key` VARCHAR(255) NULL AFTER `brand_key`,
  ADD COLUMN IF NOT EXISTS `role_key` VARCHAR(128) NULL AFTER `activity_type_key`,
  ADD COLUMN IF NOT EXISTS `workflow_key` VARCHAR(255) NULL AFTER `role_key`,
  ADD COLUMN IF NOT EXISTS `module_key` VARCHAR(255) NULL AFTER `workflow_key`,
  ADD COLUMN IF NOT EXISTS `action_key` VARCHAR(255) NULL AFTER `module_key`,
  ADD COLUMN IF NOT EXISTS `logic_key` VARCHAR(255) NULL AFTER `action_key`,
  ADD COLUMN IF NOT EXISTS `engine_key` VARCHAR(255) NULL AFTER `logic_key`,
  ADD COLUMN IF NOT EXISTS `linkage_type` VARCHAR(96) NULL AFTER `engine_key`,
  ADD COLUMN IF NOT EXISTS `resource_scope_hash` CHAR(64) NULL AFTER `linkage_type`,
  ADD COLUMN IF NOT EXISTS `visibility_scope` VARCHAR(64) NOT NULL DEFAULT 'platform_admin' AFTER `resource_scope_hash`,
  ADD COLUMN IF NOT EXISTS `authority_status` ENUM('candidate','review_required','approved','authoritative') NOT NULL DEFAULT 'candidate' AFTER `visibility_scope`,
  ADD COLUMN IF NOT EXISTS `lifecycle_status` ENUM('active','inactive','archived','superseded') NOT NULL DEFAULT 'active' AFTER `authority_status`,
  ADD COLUMN IF NOT EXISTS `confidence` DECIMAL(5,4) NOT NULL DEFAULT 1.0000 AFTER `lifecycle_status`,
  ADD COLUMN IF NOT EXISTS `approval_required` TINYINT(1) NOT NULL DEFAULT 0 AFTER `confidence`,
  ADD COLUMN IF NOT EXISTS `approved_by` VARCHAR(255) NULL AFTER `approval_required`,
  ADD COLUMN IF NOT EXISTS `approved_at` TIMESTAMP NULL DEFAULT NULL AFTER `approved_by`,
  ADD COLUMN IF NOT EXISTS `metadata_json` LONGTEXT NULL AFTER `approved_at`,
  ADD COLUMN IF NOT EXISTS `secrets_included` TINYINT(1) NOT NULL DEFAULT 0 AFTER `metadata_json`,
  ADD COLUMN IF NOT EXISTS `created_by` VARCHAR(255) NULL AFTER `secrets_included`;

UPDATE `memory_scope_links`
SET
  `resource_type` = COALESCE(`resource_type`, 'legacy_memory_scope_link'),
  `resource_ref` = COALESCE(`resource_ref`, `link_id`),
  `scope_type` = COALESCE(`scope_type`, `target_scope_type`, `source_scope_type`, 'platform'),
  `scope_ref` = COALESCE(`scope_ref`, `target_scope_ref`, `source_scope_ref`, `link_id`),
  `linkage_type` = COALESCE(`linkage_type`, `relationship_type`, 'legacy_scope_link'),
  `lifecycle_status` = COALESCE(`lifecycle_status`, CASE `status` WHEN 'revoked' THEN 'superseded' WHEN 'expired' THEN 'archived' ELSE 'active' END),
  `resource_scope_hash` = COALESCE(`resource_scope_hash`, SHA2(CONCAT(`resource_type`, '|', `resource_ref`, '|', `scope_type`, '|', `scope_ref`, '|', `linkage_type`), 256));

ALTER TABLE `memory_scope_links`
  MODIFY COLUMN `tenant_id` VARCHAR(64) NULL,
  MODIFY COLUMN `link_id` VARCHAR(96) NOT NULL,
  MODIFY COLUMN `resource_type` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `resource_ref` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `scope_type` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `scope_ref` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `linkage_type` VARCHAR(96) NOT NULL,
  MODIFY COLUMN `resource_scope_hash` CHAR(64) NOT NULL;

ALTER TABLE `memory_scope_links`
  ADD KEY IF NOT EXISTS `idx_memory_scope_resource` (`resource_type`, `resource_ref`),
  ADD KEY IF NOT EXISTS `idx_memory_scope_lookup` (`scope_type`, `scope_ref`, `lifecycle_status`),
  ADD KEY IF NOT EXISTS `idx_memory_scope_tenant_workspace` (`tenant_id`, `workspace_key`, `lifecycle_status`),
  ADD KEY IF NOT EXISTS `idx_memory_scope_brand_activity_role` (`brand_key`, `activity_type_key`, `role_key`, `lifecycle_status`),
  ADD KEY IF NOT EXISTS `idx_memory_scope_runtime` (`workflow_key`(96), `action_key`(96), `logic_key`(96), `engine_key`(96), `lifecycle_status`),
  ADD KEY IF NOT EXISTS `idx_memory_scope_asset` (`asset_id`, `asset_key`);
