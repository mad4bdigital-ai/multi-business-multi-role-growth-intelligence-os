-- Sprint 66: Connected execution continuity foundation.
-- Adds a generic DB-backed continuity layer over execution_plans, workflow_runs,
-- step_runs, approval_holds, and request_envelopes.
-- This is intentionally additive and does not enable background execution by itself.

CREATE TABLE IF NOT EXISTS `connected_execution_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `connected_session_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `root_plan_id` VARCHAR(36) NULL,
  `current_run_id` VARCHAR(36) NULL,
  `current_step_run_id` VARCHAR(36) NULL,
  `mode` ENUM('single_turn','connected_rounds','worker_driven') NOT NULL DEFAULT 'connected_rounds',
  `status` ENUM('draft','ready','running','paused','awaiting_user','awaiting_approval','blocked','completed','failed','cancelled') NOT NULL DEFAULT 'draft',
  `resume_policy_json` TEXT NULL,
  `budget_policy_json` TEXT NULL,
  `checkpoint_policy_json` TEXT NULL,
  `resume_cursor_json` TEXT NULL,
  `last_checkpoint_json` TEXT NULL,
  `next_action_json` TEXT NULL,
  `last_evidence_report_id` VARCHAR(36) NULL,
  `round_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_rounds` INT UNSIGNED NULL,
  `last_error_json` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_activity_at` DATETIME NULL DEFAULT NULL,
  `completed_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_connected_session_id` (`connected_session_id`),
  KEY `idx_connected_session_tenant_status` (`tenant_id`, `status`),
  KEY `idx_connected_session_user_status` (`user_id`, `status`),
  KEY `idx_connected_session_plan` (`root_plan_id`),
  KEY `idx_connected_session_run` (`current_run_id`),
  KEY `idx_connected_session_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `connected_execution_evidence_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `evidence_report_id` VARCHAR(36) NOT NULL,
  `connected_session_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `plan_id` VARCHAR(36) NULL,
  `run_id` VARCHAR(36) NULL,
  `step_run_id` VARCHAR(36) NULL,
  `stage` VARCHAR(128) NOT NULL,
  `status` ENUM('checkpoint','progress','blocked','handoff','resume_ready','completed','failed') NOT NULL DEFAULT 'checkpoint',
  `summary_json` TEXT NULL,
  `evidence_json` TEXT NULL,
  `ci_json` TEXT NULL,
  `readiness_json` TEXT NULL,
  `artifact_refs_json` TEXT NULL,
  `blockers_json` TEXT NULL,
  `next_action_json` TEXT NULL,
  `first_resume_instruction` VARCHAR(512) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_evidence_report_id` (`evidence_report_id`),
  KEY `idx_evidence_connected_session` (`connected_session_id`, `created_at`),
  KEY `idx_evidence_plan_run` (`plan_id`, `run_id`),
  KEY `idx_evidence_status` (`status`),
  KEY `idx_evidence_stage` (`stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `connected_execution_resume_actions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `resume_action_id` VARCHAR(36) NOT NULL,
  `connected_session_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `action_order` INT UNSIGNED NOT NULL DEFAULT 1,
  `action_kind` ENUM('tool_call','repo_operation','db_operation','provider_operation','local_device_operation','document_generation','analysis_step','approval_request','user_prompt','stop') NOT NULL,
  `action_key` VARCHAR(191) NULL,
  `action_payload_json` TEXT NULL,
  `guardrails_json` TEXT NULL,
  `status` ENUM('pending','claimed','running','completed','failed','blocked','cancelled','skipped') NOT NULL DEFAULT 'pending',
  `claim_token` VARCHAR(64) NULL,
  `claimed_at` DATETIME NULL DEFAULT NULL,
  `completed_at` DATETIME NULL DEFAULT NULL,
  `result_json` TEXT NULL,
  `error_json` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resume_action_id` (`resume_action_id`),
  KEY `idx_resume_connected_status` (`connected_session_id`, `status`, `action_order`),
  KEY `idx_resume_tenant_status` (`tenant_id`, `status`),
  KEY `idx_resume_kind_status` (`action_kind`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `connected_execution_latest_checkpoint` AS
SELECT
  s.connected_session_id,
  s.tenant_id,
  s.user_id,
  s.root_plan_id,
  s.current_run_id,
  s.status AS session_status,
  s.mode,
  s.round_count,
  s.max_rounds,
  s.next_action_json AS session_next_action_json,
  r.evidence_report_id,
  r.stage,
  r.status AS report_status,
  r.summary_json,
  r.evidence_json,
  r.blockers_json,
  r.next_action_json AS report_next_action_json,
  r.first_resume_instruction,
  r.created_at AS report_created_at,
  s.updated_at AS session_updated_at,
  0 AS secrets_included
FROM connected_execution_sessions s
LEFT JOIN connected_execution_evidence_reports r
  ON r.evidence_report_id = s.last_evidence_report_id;

INSERT IGNORE INTO `runtime_dispatch_certification_registry`
  (`certification_key`, `surface_key`, `surface_family`, `tool_or_action_key`, `risk_class`, `certification_status`, `smoke_strategy`,
   `dispatch_allowed`, `apply_allowed`, `requires_resource_authority`, `requires_dry_run`, `requires_audit_evidence`, `requires_readback`, `notes`)
VALUES
  ('connected_execution_continuity_foundation_v1', 'connected_execution_continuity', 'execution_continuity', 'connected_execution_session_resume',
   'B', 'baseline_registered', 'db_checkpoint_resume_without_background_worker', 0, 0, 0, 1, 1, 1,
   'Foundation for connected execution sessions, checkpoints, evidence reports, and pending resume actions. Does not enable autonomous background execution.');
