CREATE TABLE IF NOT EXISTS operation_managed_git_worker_leases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  worker_id CHAR(36) NOT NULL,
  lease_key_sha256 CHAR(64) NOT NULL,
  run_id CHAR(36) NULL,
  principal_scope ENUM('admin','tenant') NOT NULL,
  tenant_id CHAR(36) NULL,
  user_id CHAR(36) NULL,
  operation_key VARCHAR(128) NOT NULL,
  owner VARCHAR(191) NOT NULL,
  repo VARCHAR(191) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  checkout_strategy ENUM('virtual_git_tree') NOT NULL DEFAULT 'virtual_git_tree',
  checkout_head_sha CHAR(40) NOT NULL,
  final_head_sha CHAR(40) NULL,
  workspace_fingerprint CHAR(64) NOT NULL,
  worker_status ENUM(
    'allocated','ready','running','cleaning','cleaned','failed','expired'
  ) NOT NULL DEFAULT 'allocated',
  active_lease_key CHAR(64) NULL,
  lease_expires_at TIMESTAMP NOT NULL,
  readback_json LONGTEXT NULL,
  error_json LONGTEXT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TIMESTAMP NULL,
  running_at TIMESTAMP NULL,
  cleanup_started_at TIMESTAMP NULL,
  released_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_managed_git_worker_id (worker_id),
  UNIQUE KEY uq_operation_managed_git_worker_active_lease (active_lease_key),
  KEY idx_operation_managed_git_worker_run (run_id),
  KEY idx_operation_managed_git_worker_tenant_user (tenant_id, user_id, worker_id),
  KEY idx_operation_managed_git_worker_expiry (worker_status, lease_expires_at),
  CONSTRAINT fk_operation_managed_git_worker_run
    FOREIGN KEY (run_id) REFERENCES repository_automation_runs(run_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_operation_managed_git_worker_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
