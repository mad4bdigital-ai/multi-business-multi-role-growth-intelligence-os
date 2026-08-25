-- Staging-local additive width alignment for the immutable migration 314 capability backfill.
-- The v_platform_bindings_current UNION can expose runtime certification statuses up to VARCHAR(256).
-- Pre-create the target so migration 314 CREATE TABLE IF NOT EXISTS cannot retain VARCHAR(64).
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

CREATE TABLE IF NOT EXISTS `platform_plugin_bindings` (
  `binding_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `binding_family` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `binding_status` VARCHAR(256) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `credential_source` VARCHAR(128) NULL,
  `dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_key`),
  KEY `idx_ppb_capability_status` (`capability_key`, `binding_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
