-- Repository Intelligence V5 advisory comment lifecycle.
-- Additive only: creates a lifecycle/readback table for approval-gated advisory comments.

CREATE TABLE IF NOT EXISTS repository_advisory_comment_plans (
  plan_id varchar(36) NOT NULL,
  tenant_id varchar(36) NULL,
  workspace_id varchar(64) NULL,
  user_id varchar(64) NULL,
  resource_uri varchar(255) NOT NULL,
  owner_name varchar(128) NOT NULL,
  repo_name varchar(128) NOT NULL,
  pr_number int NOT NULL,
  classification varchar(96) NOT NULL,
  planned_comment_type varchar(96) NOT NULL,
  comment_preview_sha256 varchar(64) NOT NULL,
  comment_preview_markdown longtext NOT NULL,
  source_report_evidence_id varchar(36) NULL,
  source_planner_evidence_id varchar(36) NULL,
  approval_hold_id varchar(36) NULL,
  status enum('preview_created','approval_required','approved','posted','readback_verified','blocked','failed','retracted_manually') NOT NULL DEFAULT 'approval_required',
  posted_comment_id varchar(64) NULL,
  posted_comment_url varchar(512) NULL,
  readback_status varchar(64) NULL,
  readback_json longtext NULL,
  metadata_json longtext NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id),
  KEY idx_repo_advisory_comment_plans_repo_pr (owner_name, repo_name, pr_number),
  KEY idx_repo_advisory_comment_plans_status (status),
  KEY idx_repo_advisory_comment_plans_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
