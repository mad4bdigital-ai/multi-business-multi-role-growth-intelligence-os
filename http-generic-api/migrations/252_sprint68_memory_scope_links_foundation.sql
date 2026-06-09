-- Sprint 68: Dynamic memory scope links foundation.
-- Provides a generic, growable link table from any memory/resource row to any registered scope type.
-- This complements legacy json_asset_subject_links and enables multi-layer feed by user, tenant, workspace, brand, activity, role, runtime, and future resource scopes.

CREATE TABLE IF NOT EXISTS `memory_scope_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `link_id` VARCHAR(96) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_ref` VARCHAR(191) NOT NULL,
  `resource_table` VARCHAR(128) NULL,
  `resource_pk` VARCHAR(255) NULL,
  `asset_id` VARCHAR(255) NULL,
  `asset_key` VARCHAR(255) NULL,
  `scope_type` VARCHAR(64) NOT NULL,
  `scope_ref` VARCHAR(191) NOT NULL,
  `scope_key` VARCHAR(255) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(255) NULL,
  `workspace_key` VARCHAR(128) NULL,
  `brand_key` VARCHAR(255) NULL,
  `activity_type_key` VARCHAR(255) NULL,
  `role_key` VARCHAR(128) NULL,
  `workflow_key` VARCHAR(255) NULL,
  `module_key` VARCHAR(255) NULL,
  `action_key` VARCHAR(255) NULL,
  `logic_key` VARCHAR(255) NULL,
  `engine_key` VARCHAR(255) NULL,
  `linkage_type` VARCHAR(96) NOT NULL,
  `resource_scope_hash` CHAR(64) GENERATED ALWAYS AS (SHA2(CONCAT_WS('|', `resource_type`, `resource_ref`, `scope_type`, `scope_ref`, `linkage_type`), 256)) STORED,
  `visibility_scope` VARCHAR(64) NOT NULL DEFAULT 'platform_admin',
  `authority_status` ENUM('candidate','review_required','approved','authoritative') NOT NULL DEFAULT 'candidate',
  `lifecycle_status` ENUM('active','inactive','archived','superseded') NOT NULL DEFAULT 'active',
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `approved_by` VARCHAR(255) NULL,
  `approved_at` TIMESTAMP NULL DEFAULT NULL,
  `metadata_json` LONGTEXT NULL CHECK (JSON_VALID(`metadata_json`) OR `metadata_json` IS NULL),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_memory_scope_link_id` (`link_id`),
  UNIQUE KEY `uq_memory_scope_resource_scope` (`resource_scope_hash`),
  KEY `idx_memory_scope_resource` (`resource_type`, `resource_ref`),
  KEY `idx_memory_scope_lookup` (`scope_type`, `scope_ref`, `lifecycle_status`),
  KEY `idx_memory_scope_tenant_workspace` (`tenant_id`, `workspace_key`, `lifecycle_status`),
  KEY `idx_memory_scope_brand_activity_role` (`brand_key`, `activity_type_key`, `role_key`, `lifecycle_status`),
  KEY `idx_memory_scope_runtime` (`workflow_key`(96), `action_key`(96), `logic_key`(96), `engine_key`(96), `lifecycle_status`),
  KEY `idx_memory_scope_asset` (`asset_id`, `asset_key`),
  CONSTRAINT `fk_memory_scope_links_scope_type`
    FOREIGN KEY (`scope_type`) REFERENCES `memory_scope_type_registry` (`scope_type`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_memory_scope_link_registry_issues` AS
SELECT
  l.link_id,
  l.resource_type,
  l.resource_ref,
  l.scope_type,
  l.scope_ref,
  'unregistered_scope_type' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'resource_type', l.resource_type,
    'resource_ref', l.resource_ref,
    'scope_type', l.scope_type,
    'scope_ref', l.scope_ref,
    'secrets_included', false
  ) AS evidence_json
FROM `memory_scope_links` l
LEFT JOIN `memory_scope_type_registry` r ON r.scope_type = l.scope_type
WHERE r.scope_type IS NULL
UNION ALL
SELECT
  l.link_id,
  l.resource_type,
  l.resource_ref,
  l.scope_type,
  l.scope_ref,
  'secret_flag_set_on_memory_link' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'resource_type', l.resource_type,
    'resource_ref', l.resource_ref,
    'scope_type', l.scope_type,
    'scope_ref', l.scope_ref,
    'secrets_included', l.secrets_included
  ) AS evidence_json
FROM `memory_scope_links` l
WHERE l.secrets_included <> 0;
