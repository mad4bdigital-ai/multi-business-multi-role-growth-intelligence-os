CREATE TABLE IF NOT EXISTS operation_run_ownership (
  run_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  resource_uri VARCHAR(500) NULL,
  operation_key VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id),
  KEY idx_operation_run_ownership_tenant_user (tenant_id, user_id, run_id),
  KEY idx_operation_run_ownership_workspace (workspace_id, run_id),
  CONSTRAINT fk_operation_run_ownership_run
    FOREIGN KEY (run_id) REFERENCES repository_automation_runs(run_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
