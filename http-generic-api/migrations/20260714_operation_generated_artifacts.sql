CREATE TABLE IF NOT EXISTS operation_generated_artifacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  artifact_id CHAR(36) NOT NULL,
  artifact_key_sha256 CHAR(64) NOT NULL,
  run_id CHAR(36) NOT NULL,
  principal_scope ENUM('admin','tenant') NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  user_id CHAR(36) NULL,
  operation_key VARCHAR(128) NULL,
  artifact_type VARCHAR(64) NOT NULL,
  artifact_uri VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(191) NULL,
  checksum_sha256 CHAR(64) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  redaction_status ENUM('redacted','non_secret','unknown') NOT NULL DEFAULT 'unknown',
  metadata_json LONGTEXT NULL,
  status ENUM('registered','unavailable','invalid') NOT NULL DEFAULT 'registered',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_generated_artifacts_id (artifact_id),
  UNIQUE KEY uq_operation_generated_artifacts_run_key (run_id, artifact_key_sha256),
  KEY idx_operation_generated_artifacts_run_page (run_id, artifact_id),
  KEY idx_operation_generated_artifacts_tenant_user (tenant_id, user_id, run_id),
  KEY idx_operation_generated_artifacts_type (artifact_type, run_id),
  CONSTRAINT fk_operation_generated_artifacts_run
    FOREIGN KEY (run_id) REFERENCES repository_automation_runs(run_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_operation_generated_artifacts_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
