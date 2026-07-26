-- Sprint 66: Governed migration execution ledger.
-- Records successful governed-migration-runner apply executions with checksums,
-- preflight status, statement counts, and bounded JSON evidence.
-- Additive only. No drops, deletes, or destructive changes.

CREATE TABLE IF NOT EXISTS `governed_migration_ledger` (
  `run_id` CHAR(36) NOT NULL,
  `migration_file` VARCHAR(255) NOT NULL,
  `migration_checksum_sha256` CHAR(64) NOT NULL,
  `applied_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `applied_by` VARCHAR(191) NOT NULL DEFAULT 'governed_migration_runner',
  `runner_version` VARCHAR(64) NOT NULL,
  `mode` VARCHAR(32) NOT NULL DEFAULT 'apply',
  `statement_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `preflight_status` VARCHAR(32) NOT NULL,
  `preflight_risk_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `requirements_json` LONGTEXT NULL,
  `results_json` LONGTEXT NULL,
  `before_schema_objects_json` LONGTEXT NULL,
  `after_schema_objects_json` LONGTEXT NULL,
  `metadata_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`run_id`),
  KEY `idx_governed_migration_ledger_file` (`migration_file`),
  KEY `idx_governed_migration_ledger_applied_at` (`applied_at`),
  KEY `idx_governed_migration_ledger_checksum` (`migration_checksum_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
