-- Spec 012 governed policy registry authority for T019/T024B/T029A-T029C.
-- Additive design only. This file is intentionally absent from
-- governed_migration_authorization_registry and MUST NOT be applied without
-- governed preflight, explicit authorization, ledger readback, and schema readback.
-- No active questionnaire/domain seed is inserted by this migration.

CREATE TABLE IF NOT EXISTS `governed_policy_safety_bounds` (
  `safety_bounds_id` CHAR(36) NOT NULL,
  `safety_bounds_key` VARCHAR(191) NOT NULL,
  `safety_bounds_version` VARCHAR(64) NOT NULL,
  `domain_key` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `bounds_json` LONGTEXT NOT NULL,
  `safety_bounds_sha256` CHAR(64) NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6) NULL,
  `created_by` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`safety_bounds_id`),
  UNIQUE KEY `uq_gp_safety_bounds_version` (`safety_bounds_key`,`safety_bounds_version`),
  KEY `idx_gp_safety_bounds_active` (`domain_key`,`status`,`effective_at`,`expires_at`),
  CONSTRAINT `chk_gp_safety_bounds_json` CHECK (JSON_VALID(`bounds_json`)),
  CONSTRAINT `chk_gp_safety_bounds_sha` CHECK (`safety_bounds_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_safety_bounds_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_domain_adoptions` (
  `adoption_id` CHAR(36) NOT NULL,
  `domain_key` VARCHAR(191) NOT NULL,
  `purpose_key` VARCHAR(191) NOT NULL,
  `questionnaire_key` VARCHAR(191) NOT NULL,
  `safety_bounds_key` VARCHAR(191) NOT NULL,
  `compiler_key` VARCHAR(191) NOT NULL,
  `runtime_registry_key` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `adoption_sha256` CHAR(64) NOT NULL,
  `approved_by` VARCHAR(191) NOT NULL,
  `approved_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`adoption_id`),
  UNIQUE KEY `uq_gp_domain_adoption` (`domain_key`,`purpose_key`),
  KEY `idx_gp_domain_adoption_runtime` (`runtime_registry_key`,`status`),
  KEY `idx_gp_domain_adoption_questionnaire` (`questionnaire_key`,`status`),
  CONSTRAINT `chk_gp_domain_adoption_sha` CHECK (`adoption_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_domain_adoption_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
