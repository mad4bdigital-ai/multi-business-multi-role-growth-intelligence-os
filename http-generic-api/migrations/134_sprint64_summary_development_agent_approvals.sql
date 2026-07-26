-- Sprint 64: Approval gate for summary-development local agent execution.
-- This records explicit approvals for future read-only OpenClaude execution.
-- It does not execute local agents and does not mutate repositories.

CREATE TABLE IF NOT EXISTS summary_development_agent_approvals (
  approval_id VARCHAR(36) NOT NULL PRIMARY KEY,
  approval_key VARCHAR(191) NOT NULL UNIQUE,
  signal_id VARCHAR(36) NOT NULL,
  signal_key VARCHAR(191) NULL,
  runtime_key VARCHAR(191) NOT NULL,
  repo_scope ENUM('platform_repo') NOT NULL DEFAULT 'platform_repo',
  approval_mode ENUM('repo_analysis_read_only') NOT NULL DEFAULT 'repo_analysis_read_only',
  approval_status ENUM('approved','revoked','expired','used') NOT NULL DEFAULT 'approved',
  approved_tools_json JSON NULL,
  denied_tools_json JSON NULL,
  approval_phrase VARCHAR(191) NOT NULL,
  approved_by VARCHAR(191) NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  result_run_id VARCHAR(36) NULL,
  policy_json JSON NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_summary_dev_agent_approvals_signal (signal_id, approval_status),
  KEY idx_summary_dev_agent_approvals_runtime (runtime_key, approval_status, expires_at),
  KEY idx_summary_dev_agent_approvals_scope (repo_scope, approval_mode, approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
