-- Staging-local additive compatibility bridge for the immutable migration 314 graph writers.
-- The source views and registries intentionally expose 255/256-character domains.
-- Preserve those domains before the historical backfill; do not truncate or rewrite rows.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

CREATE TABLE IF NOT EXISTS `platform_plugin_capability_exports` (
  `export_key` VARCHAR(255) NOT NULL,
  `capability_key` VARCHAR(255) NOT NULL,
  `export_surface` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `export_status` VARCHAR(64) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `http_method` VARCHAR(32) NULL,
  `http_path` VARCHAR(512) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`export_key`),
  KEY `idx_ppce_capability_status` (`capability_key`, `export_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_source_links` (
  `link_id` CHAR(64) NOT NULL,
  `capability_key` VARCHAR(255) NOT NULL,
  `source_kind` VARCHAR(64) NOT NULL,
  `source_ref` VARCHAR(512) NOT NULL,
  `source_sha` CHAR(64) NULL,
  `resolution_status` VARCHAR(64) NOT NULL DEFAULT 'resolved',
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `evidence_id` VARCHAR(255) NULL,
  `metadata_json` LONGTEXT NULL,
  `observed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`link_id`),
  KEY `idx_pcsl_capability_status` (`capability_key`, `resolution_status`),
  KEY `idx_pcsl_source_kind` (`source_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_evidence_events` (
  `evidence_id` VARCHAR(255) NOT NULL,
  `evidence_type` VARCHAR(128) NOT NULL,
  `subject_type` VARCHAR(96) NOT NULL,
  `subject_key` VARCHAR(255) NOT NULL,
  `capability_key` VARCHAR(255) NULL,
  `envelope_id` VARCHAR(36) NULL,
  `binding_id` VARCHAR(36) NULL,
  `certification_id` VARCHAR(255) NULL,
  `source_system` VARCHAR(128) NOT NULL DEFAULT 'mysql_primary',
  `source_ref` VARCHAR(512) NULL,
  `source_sha` CHAR(64) NULL,
  `evidence_status` ENUM('observed','passed','blocked','failed','expired','revoked','superseded') NOT NULL DEFAULT 'observed',
  `reason_code` VARCHAR(256) NULL,
  `payload_hash` CHAR(64) NULL,
  `evidence_json` LONGTEXT NULL,
  `observed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `supersedes_evidence_id` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`evidence_id`),
  KEY `idx_pee_capability_type` (`capability_key`, `evidence_type`),
  KEY `idx_pee_envelope` (`envelope_id`),
  KEY `idx_pee_binding` (`binding_id`),
  KEY `idx_pee_status_freshness` (`evidence_status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_certifications` (
  `certification_id` VARCHAR(255) NOT NULL,
  `capability_key` VARCHAR(255) NOT NULL,
  `certification_type` VARCHAR(128) NOT NULL,
  `environment` VARCHAR(64) NOT NULL DEFAULT 'production',
  `subject_type` VARCHAR(96) NULL,
  `subject_key` VARCHAR(255) NULL,
  `certification_status` VARCHAR(256) NOT NULL,
  `evidence_id` VARCHAR(255) NULL,
  `source_registry` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `certified_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `metadata_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`certification_id`),
  KEY `idx_pcc_capability_status` (`capability_key`, `certification_status`),
  KEY `idx_pcc_expiry` (`expires_at`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS `platform_plugin_capabilities`
  MODIFY COLUMN `capability_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `runtime_status` VARCHAR(256) NOT NULL;

ALTER TABLE IF EXISTS `platform_plugin_capability_exports`
  MODIFY COLUMN `export_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `capability_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `http_method` VARCHAR(32) NULL;

ALTER TABLE IF EXISTS `platform_capability_source_links`
  MODIFY COLUMN `capability_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `evidence_id` VARCHAR(255) NULL;

ALTER TABLE IF EXISTS `platform_evidence_events`
  MODIFY COLUMN `evidence_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `capability_key` VARCHAR(255) NULL,
  MODIFY COLUMN `certification_id` VARCHAR(255) NULL,
  MODIFY COLUMN `reason_code` VARCHAR(256) NULL;

ALTER TABLE IF EXISTS `platform_capability_certifications`
  MODIFY COLUMN `certification_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `capability_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `certification_status` VARCHAR(256) NOT NULL,
  MODIFY COLUMN `evidence_id` VARCHAR(255) NULL;
