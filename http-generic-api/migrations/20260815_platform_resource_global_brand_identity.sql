-- Platform Resource Identity + Global Brand Identity v2 (additive foundation)
-- Safety:
--   * Additive schema only. No destructive merge, delete, provider call, credential read,
--     Production promotion, or implicit authority grant.
--   * Existing brands.target_key remains a compatibility reference.
--   * Existing tenant_brand_links remain valid and are extended into typed relationships.
--   * Existing target_key values are registered as aliases one-to-one; no rows are merged.
--   * Relationship rows never imply authority. Effective authority remains in
--     workspace_resource_grants + policy/approval runtime.
--
-- Activation sequence:
--   schema -> shadow resolver -> reconciliation dry-run -> governed migration readback
--   -> staging canary -> separate exact-SHA promotion. This file does not perform promotion.

SET NAMES utf8mb4;

ALTER TABLE `brands`
  ADD COLUMN IF NOT EXISTS `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL AFTER `id`,
  ADD COLUMN IF NOT EXISTS `identity_status` enum('provisional','verified','disputed','superseded','archived') NOT NULL DEFAULT 'provisional' AFTER `target_key`,
  ADD COLUMN IF NOT EXISTS `resource_revision` bigint unsigned NOT NULL DEFAULT 1 AFTER `identity_status`;

-- Existing global rows receive deterministic immutable IDs. This is one-to-one and does
-- not deduplicate or merge any legacy rows.
UPDATE `brands`
SET `brand_id` = LOWER(CONCAT(
  SUBSTR(SHA2(CONCAT('global-brand|', `id`, '|', COALESCE(`target_key`, '')), 256), 1, 8), '-',
  SUBSTR(SHA2(CONCAT('global-brand|', `id`, '|', COALESCE(`target_key`, '')), 256), 9, 4), '-4',
  SUBSTR(SHA2(CONCAT('global-brand|', `id`, '|', COALESCE(`target_key`, '')), 256), 14, 3), '-a',
  SUBSTR(SHA2(CONCAT('global-brand|', `id`, '|', COALESCE(`target_key`, '')), 256), 18, 3), '-',
  SUBSTR(SHA2(CONCAT('global-brand|', `id`, '|', COALESCE(`target_key`, '')), 256), 21, 12)
))
WHERE `brand_id` IS NULL OR TRIM(`brand_id`) = '';

SET @brand_id_unique_exists := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'brands'
     AND INDEX_NAME = 'uq_brands_brand_id'
);
SET @brand_id_unique_sql := IF(
  @brand_id_unique_exists = 0,
  'ALTER TABLE `brands` ADD UNIQUE KEY `uq_brands_brand_id` (`brand_id`)',
  'SELECT ''uq_brands_brand_id_exists'' AS migration_note'
);
PREPARE brand_id_unique_stmt FROM @brand_id_unique_sql;
EXECUTE brand_id_unique_stmt;
DEALLOCATE PREPARE brand_id_unique_stmt;

CREATE TABLE IF NOT EXISTS `brand_identifiers` (
  `identifier_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `identifier_type` varchar(64) NOT NULL,
  `normalized_value` varchar(512) NOT NULL,
  `normalized_value_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `provider_family` varchar(64) NOT NULL DEFAULT '',
  `verification_status` enum('unverified','pending','verified','rejected','revoked','expired') NOT NULL DEFAULT 'unverified',
  `verification_method` varchar(64) DEFAULT NULL,
  `confidence_class` enum('hard','medium','weak') NOT NULL DEFAULT 'weak',
  `exclusive_scope` varchar(32) NOT NULL DEFAULT 'non_exclusive',
  `valid_from` timestamp NULL DEFAULT NULL,
  `valid_until` timestamp NULL DEFAULT NULL,
  `source` varchar(64) NOT NULL,
  `evidence_ref` varchar(191) DEFAULT NULL,
  `status` enum('active','inactive','superseded','revoked') NOT NULL DEFAULT 'active',
  `revision` bigint unsigned NOT NULL DEFAULT 1,
  `created_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`identifier_id`),
  UNIQUE KEY `uq_brand_identifier_identity` (`brand_id`,`identifier_type`,`provider_family`,`normalized_value_hash`,`status`),
  KEY `idx_brand_identifier_resolve` (`identifier_type`,`provider_family`,`normalized_value_hash`,`status`,`verification_status`),
  KEY `idx_brand_identifier_brand` (`brand_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `brand_identity_aliases` (
  `alias_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `alias_type` varchar(64) NOT NULL,
  `alias_value` varchar(512) NOT NULL,
  `alias_value_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `status` enum('active','inactive','superseded','revoked') NOT NULL DEFAULT 'active',
  `source` varchar(64) NOT NULL,
  `superseded_by_alias_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci DEFAULT NULL,
  `created_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`alias_id`),
  UNIQUE KEY `uq_brand_alias_resolve` (`alias_type`,`alias_value_hash`,`status`),
  KEY `idx_brand_alias_brand` (`brand_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `brand_claims` (
  `claim_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `claimant_tenant_id` varchar(36) NOT NULL,
  `claim_type` varchar(32) NOT NULL,
  `requested_relationship` varchar(32) NOT NULL,
  `status` enum('pending_verification','verified','rejected','disputed','revoked','expired','superseded') NOT NULL DEFAULT 'pending_verification',
  `created_by` varchar(64) NOT NULL,
  `evidence_summary_json` json DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `superseded_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci DEFAULT NULL,
  `revision` bigint unsigned NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`claim_id`),
  KEY `idx_brand_claim_brand_status` (`brand_id`,`status`),
  KEY `idx_brand_claim_tenant_status` (`claimant_tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `brand_verification_evidence` (
  `evidence_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `claim_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `verification_method` varchar(64) NOT NULL,
  `evidence_type` varchar(64) NOT NULL,
  `evidence_ref` varchar(191) DEFAULT NULL,
  `evidence_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `verification_status` enum('pending','verified','rejected','revoked','expired') NOT NULL DEFAULT 'pending',
  `metadata_json` json DEFAULT NULL,
  `valid_from` timestamp NULL DEFAULT NULL,
  `valid_until` timestamp NULL DEFAULT NULL,
  `verified_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`evidence_id`),
  KEY `idx_brand_evidence_claim` (`claim_id`,`verification_status`),
  KEY `idx_brand_evidence_brand` (`brand_id`,`verification_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `tenant_relationships` (
  `relationship_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  `from_tenant_id` varchar(36) NOT NULL,
  `to_tenant_id` varchar(36) NOT NULL,
  `relationship_type` varchar(64) NOT NULL,
  `relationship_status` enum('pending','active','inactive','revoked','expired','superseded') NOT NULL DEFAULT 'pending',
  `verification_status` enum('unverified','pending','verified','rejected','revoked','expired') NOT NULL DEFAULT 'unverified',
  `relationship_source` varchar(64) NOT NULL,
  `effective_from` timestamp NULL DEFAULT NULL,
  `effective_until` timestamp NULL DEFAULT NULL,
  `evidence_ref` varchar(191) DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `revision` bigint unsigned NOT NULL DEFAULT 1,
  `created_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relationship_id`),
  UNIQUE KEY `uq_tenant_relationship_identity` (`from_tenant_id`,`to_tenant_id`,`relationship_type`,`relationship_status`),
  KEY `idx_tenant_relationship_from` (`from_tenant_id`,`relationship_status`),
  KEY `idx_tenant_relationship_to` (`to_tenant_id`,`relationship_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE `tenant_brand_links`
  ADD COLUMN IF NOT EXISTS `brand_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL AFTER `tenant_id`,
  ADD COLUMN IF NOT EXISTS `relationship_type` varchar(32) NOT NULL DEFAULT 'operator' AFTER `brand_target_key`,
  ADD COLUMN IF NOT EXISTS `relationship_status` enum('pending_verification','active','inactive','revoked','expired','superseded') NOT NULL DEFAULT 'active' AFTER `relationship_type`,
  ADD COLUMN IF NOT EXISTS `verification_status` enum('unverified','pending','verified','rejected','revoked','expired') NOT NULL DEFAULT 'unverified' AFTER `relationship_status`,
  ADD COLUMN IF NOT EXISTS `claim_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL AFTER `verification_status`,
  ADD COLUMN IF NOT EXISTS `relationship_source` varchar(64) NOT NULL DEFAULT 'legacy_tenant_brand_link' AFTER `claim_id`,
  ADD COLUMN IF NOT EXISTS `authority_policy_ref` varchar(191) DEFAULT NULL AFTER `relationship_source`,
  ADD COLUMN IF NOT EXISTS `effective_from` timestamp NULL DEFAULT NULL AFTER `authority_policy_ref`,
  ADD COLUMN IF NOT EXISTS `effective_until` timestamp NULL DEFAULT NULL AFTER `effective_from`,
  ADD COLUMN IF NOT EXISTS `revision` bigint unsigned NOT NULL DEFAULT 1 AFTER `effective_until`;

-- Safe one-to-one compatibility backfill. This does not infer ownership or authority.
UPDATE `tenant_brand_links` AS tbl
JOIN `brands` AS b
  ON CONVERT(tbl.`brand_target_key` USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci
   = CONVERT(b.`target_key` USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci
SET
  tbl.`brand_id` = COALESCE(tbl.`brand_id`, b.`brand_id`),
  tbl.`relationship_type` = COALESCE(NULLIF(tbl.`relationship_type`, ''), 'operator'),
  tbl.`relationship_status` = CASE WHEN tbl.`status`='active' THEN 'active' ELSE 'inactive' END,
  tbl.`verification_status` = COALESCE(NULLIF(tbl.`verification_status`, ''), 'unverified'),
  tbl.`relationship_source` = COALESCE(NULLIF(tbl.`relationship_source`, ''), 'legacy_tenant_brand_link'),
  tbl.`revision` = GREATEST(COALESCE(tbl.`revision`, 1), 1)
WHERE b.`brand_id` IS NOT NULL;

SET @tenant_brand_id_index_exists := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'tenant_brand_links'
     AND INDEX_NAME = 'idx_tenant_brand_links_brand_id_status'
);
SET @tenant_brand_id_index_sql := IF(
  @tenant_brand_id_index_exists = 0,
  'ALTER TABLE `tenant_brand_links` ADD KEY `idx_tenant_brand_links_brand_id_status` (`brand_id`,`relationship_status`,`status`)',
  'SELECT ''idx_tenant_brand_links_brand_id_status_exists'' AS migration_note'
);
PREPARE tenant_brand_id_index_stmt FROM @tenant_brand_id_index_sql;
EXECUTE tenant_brand_id_index_stmt;
DEALLOCATE PREPARE tenant_brand_id_index_stmt;

-- Every legacy target_key is preserved as an exact alias to its existing row.
INSERT INTO `brand_identity_aliases`
  (`alias_id`,`alias_type`,`alias_value`,`alias_value_hash`,`brand_id`,`status`,`source`,`created_by`)
SELECT
  LOWER(CONCAT(
    SUBSTR(SHA2(CONCAT('brand-alias|legacy_target_key|', b.`target_key`), 256), 1, 8), '-',
    SUBSTR(SHA2(CONCAT('brand-alias|legacy_target_key|', b.`target_key`), 256), 9, 4), '-4',
    SUBSTR(SHA2(CONCAT('brand-alias|legacy_target_key|', b.`target_key`), 256), 14, 3), '-a',
    SUBSTR(SHA2(CONCAT('brand-alias|legacy_target_key|', b.`target_key`), 256), 18, 3), '-',
    SUBSTR(SHA2(CONCAT('brand-alias|legacy_target_key|', b.`target_key`), 256), 21, 12)
  )),
  'legacy_target_key',
  b.`target_key`,
  SHA2(b.`target_key`, 256),
  b.`brand_id`,
  'active',
  'global_brand_identity_v2_migration',
  'governed_migration'
FROM `brands` b
WHERE b.`brand_id` IS NOT NULL
  AND b.`target_key` IS NOT NULL
  AND TRIM(b.`target_key`) <> ''
ON DUPLICATE KEY UPDATE
  `brand_id`=VALUES(`brand_id`),
  `source`=VALUES(`source`),
  `updated_at`=CURRENT_TIMESTAMP;

-- Readback only. A governed runner must inspect these counts before any activation.
SELECT
  (SELECT COUNT(*) FROM `brands` WHERE `brand_id` IS NULL OR TRIM(`brand_id`)='') AS `brands_missing_global_id`,
  (SELECT COUNT(*) FROM `brands` b LEFT JOIN `brand_identity_aliases` a
     ON a.`brand_id`=b.`brand_id` AND a.`alias_type`='legacy_target_key' AND a.`status`='active'
    WHERE b.`target_key` IS NOT NULL AND TRIM(b.`target_key`)<>'' AND a.`alias_id` IS NULL) AS `brands_missing_legacy_alias`,
  (SELECT COUNT(*) FROM `tenant_brand_links` WHERE `brand_id` IS NULL) AS `tenant_brand_links_missing_brand_id`,
  0 AS `authority_grants_created`,
  0 AS `provider_mutations_executed`,
  0 AS `production_promotions_executed`;
