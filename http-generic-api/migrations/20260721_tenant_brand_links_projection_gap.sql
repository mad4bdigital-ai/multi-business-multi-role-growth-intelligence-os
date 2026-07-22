-- Spec 006: Tenant Brand Links projection gap
-- Purpose:
--   Add a governed tenant-to-brand authority surface for Dynamic Container projection.
--   The legacy brands table is global and intentionally has no tenant_id column, while
--   brand workspaces may need a tenant-scoped canonical brands.target_key fallback when
--   workspace_registry.linked_brand_key is not populated.
-- Safety:
--   - Additive schema only.
--   - Does not modify brands or workspace_registry.
--   - Seeds only verified tenant metadata brand_key links that resolve to active brands.target_key.
--   - No provider call, credential read, external send, secret read, enforcement, or promotion.
-- Readback:
--   1. tenant_brand_links exists.
--   2. active links resolve to active brands.target_key.
--   3. dynamic_container_projection_dry_run can use tenant_brand_links as a fallback for brand workspaces.

CREATE TABLE IF NOT EXISTS `tenant_brand_links` (
  `link_id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `brand_target_key` varchar(191) NOT NULL,
  `link_source` varchar(64) NOT NULL DEFAULT 'tenant_metadata_brand_key',
  `status` enum('active','inactive','superseded') NOT NULL DEFAULT 'active',
  `metadata_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`link_id`),
  UNIQUE KEY `uq_tenant_brand_links_active` (`tenant_id`,`brand_target_key`,`status`),
  KEY `idx_tenant_brand_links_tenant_status` (`tenant_id`,`status`),
  KEY `idx_tenant_brand_links_brand_status` (`brand_target_key`,`status`),
  CONSTRAINT `fk_tenant_brand_links_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tenant_brand_links`
  (`link_id`,`tenant_id`,`brand_target_key`,`link_source`,`status`,`metadata_json`)
SELECT
  LOWER(CONCAT(
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', t.`tenant_id`, '|', JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key'))), 256), 1, 8), '-',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', t.`tenant_id`, '|', JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key'))), 256), 9, 4), '-4',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', t.`tenant_id`, '|', JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key'))), 256), 14, 3), '-a',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', t.`tenant_id`, '|', JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key'))), 256), 18, 3), '-',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', t.`tenant_id`, '|', JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key'))), 256), 21, 12)
  )) AS `link_id`,
  t.`tenant_id`,
  b.`target_key` AS `brand_target_key`,
  'tenant_metadata_brand_key' AS `link_source`,
  'active' AS `status`,
  JSON_OBJECT(
    'source_table','tenants',
    'source_field','metadata_json.brand_key',
    'authority_implied', false,
    'secrets_included', false
  ) AS `metadata_json`
FROM `tenants` t
JOIN `brands` b
  ON LOWER(b.`target_key`) = LOWER(JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key')))
WHERE t.`status` = 'active'
  AND JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(t.`metadata_json`, '$.brand_key')) <> ''
  AND LOWER(COALESCE(b.`status`, '')) = 'active'
ON DUPLICATE KEY UPDATE
  `brand_target_key` = VALUES(`brand_target_key`),
  `link_source` = VALUES(`link_source`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
