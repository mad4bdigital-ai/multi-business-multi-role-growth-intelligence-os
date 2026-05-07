-- Sprint 28: Schema Import Pipeline
-- Adds schema_import_jobs table and schema_json/import tracking columns to actions and endpoints

CREATE TABLE IF NOT EXISTS `schema_import_jobs` (
  `id`                    INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  `job_id`                VARCHAR(36)    NOT NULL UNIQUE,
  `action_key`            VARCHAR(128)   NOT NULL,
  `source_type`           ENUM('upload','repo_link','rollback') NOT NULL,
  `source_url`            TEXT           NULL     COMMENT 'Raw content URL for repo_link imports',
  `source_ref`            VARCHAR(256)   NULL     COMMENT 'Git branch/tag/commit for repo_link imports',
  `source_filename`       VARCHAR(512)   NULL     COMMENT 'Original filename for upload imports',
  `raw_schema`            LONGTEXT       NULL     COMMENT 'Full YAML/JSON as received — used for audit and re-import',
  `endpoint_snapshots`    JSON           NULL     COMMENT 'Processed per-operation specs at import time — used for rollback',
  `endpoints_upserted`    INT UNSIGNED   NOT NULL DEFAULT 0,
  `endpoints_deprecated`  INT UNSIGNED   NOT NULL DEFAULT 0,
  `warnings`              JSON           NULL,
  `status`                ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  `error_message`         TEXT           NULL,
  `imported_by`           VARCHAR(128)   NULL,
  `imported_at`           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sij_action_key`  (`action_key`),
  INDEX `idx_sij_status`      (`status`),
  INDEX `idx_sij_imported_at` (`imported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `actions`
  ADD COLUMN IF NOT EXISTS `schema_json`        LONGTEXT    NULL    COMMENT 'Action-level OpenAPI meta (info, servers, security) — set by schema import' AFTER `openai_schema_file_id`,
  ADD COLUMN IF NOT EXISTS `import_job_id`      VARCHAR(36) NULL    COMMENT 'Last schema_import_jobs.job_id that wrote this row' AFTER `schema_json`,
  ADD COLUMN IF NOT EXISTS `schema_imported_at` DATETIME    NULL    AFTER `import_job_id`;

ALTER TABLE `endpoints`
  ADD COLUMN IF NOT EXISTS `schema_json`        LONGTEXT    NULL    COMMENT 'Dereferenced per-operation OpenAPI spec — set by schema import' AFTER `child_openai_schema_file_id`,
  ADD COLUMN IF NOT EXISTS `import_job_id`      VARCHAR(36) NULL    COMMENT 'Last schema_import_jobs.job_id that wrote this row' AFTER `schema_json`,
  ADD COLUMN IF NOT EXISTS `schema_imported_at` DATETIME    NULL    AFTER `import_job_id`;
