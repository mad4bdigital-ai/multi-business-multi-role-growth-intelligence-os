-- MariaDB 11.4 FK compatibility bridge for tenant_brand_links.
-- Additive DDL only: the historical 20260721 migration remains immutable.
-- Preserve the historical table-level UCA collation while pinning the FK
-- column to the canonical tenants.tenant_id collation.
CREATE TABLE IF NOT EXISTS `tenant_brand_links` (
  `link_id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
