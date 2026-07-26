-- Spec Kit 006 implementation slice 1: authority scope registry foundation.
-- Additive, read-only foundation. No enforcement changes and no mutation of Sprint69 authority tables.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `authority_scope_registry` (
  `scope_id` VARCHAR(64) NOT NULL,
  `scope_key` VARCHAR(191) NOT NULL,
  `scope_type` ENUM('platform','tenant') NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `status` ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope_id`),
  UNIQUE KEY `uq_authority_scope_key` (`scope_key`),
  UNIQUE KEY `uq_authority_scope_tenant` (`tenant_id`),
  KEY `idx_authority_scope_type_status` (`scope_type`,`status`),
  CONSTRAINT `chk_authority_scope_tenant_consistency`
    CHECK (
      (`scope_type` = 'platform' AND `tenant_id` IS NULL)
      OR
      (`scope_type` = 'tenant' AND `tenant_id` IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `authority_scope_registry`
  (`scope_id`,`scope_key`,`scope_type`,`tenant_id`,`status`,`version`,`metadata_json`,`created_by`)
VALUES
  (
    'ascope_platform_root',
    'platform:root',
    'platform',
    NULL,
    'active',
    1,
    JSON_OBJECT(
      'seed','spec_006_slice_1',
      'shadow_only',true,
      'grants_authority',false,
      'contains_admin_workspace',true
    ),
    'migration'
  )
ON DUPLICATE KEY UPDATE
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `authority_scope_registry`
  (`scope_id`,`scope_key`,`scope_type`,`tenant_id`,`status`,`version`,`metadata_json`,`created_by`)
SELECT
  CONCAT('ascope_tenant_', REPLACE(t.`tenant_id`, '-', '')),
  CONCAT('tenant:', t.`tenant_id`),
  'tenant',
  t.`tenant_id`,
  CASE
    WHEN t.`status` = 'active' THEN 'active'
    WHEN t.`status` = 'archived' THEN 'archived'
    ELSE 'suspended'
  END,
  1,
  JSON_OBJECT(
    'seed','spec_006_slice_1',
    'shadow_only',true,
    'grants_authority',false,
    'source_table','tenants'
  ),
  'migration'
FROM `tenants` t
ON DUPLICATE KEY UPDATE
  `scope_key` = VALUES(`scope_key`),
  `scope_type` = VALUES(`scope_type`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
