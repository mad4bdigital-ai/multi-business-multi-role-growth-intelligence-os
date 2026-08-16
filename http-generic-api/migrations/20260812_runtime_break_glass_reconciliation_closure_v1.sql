-- Spec 018 / Runtime Break-Glass Reconciliation Closure D07-D13
-- Additive evidence columns only. No Git, deployment, Hostinger, or provider mutation is executed by this migration.

ALTER TABLE `runtime_break_glass_incidents`
  ADD COLUMN IF NOT EXISTS `repository_reconciliation_plan_id` VARCHAR(64) NULL AFTER `reconciliation_started_at`,
  ADD COLUMN IF NOT EXISTS `repository_reconciliation_plan_sha256` CHAR(64) NULL AFTER `repository_reconciliation_plan_id`,
  ADD COLUMN IF NOT EXISTS `repository_reconciliation_pr_number` BIGINT UNSIGNED NULL AFTER `repository_reconciliation_plan_sha256`,
  ADD COLUMN IF NOT EXISTS `main_commit_sha` CHAR(40) NULL AFTER `repository_reconciliation_pr_number`,
  ADD COLUMN IF NOT EXISTS `main_committed_at` DATETIME(3) NULL AFTER `main_commit_sha`,
  ADD COLUMN IF NOT EXISTS `staging_verification_json` JSON NULL AFTER `main_committed_at`,
  ADD COLUMN IF NOT EXISTS `staging_verified_at` DATETIME(3) NULL AFTER `staging_verification_json`,
  ADD COLUMN IF NOT EXISTS `production_commit_sha` CHAR(40) NULL AFTER `staging_verified_at`,
  ADD COLUMN IF NOT EXISTS `production_promotion_authorization_id` VARCHAR(191) NULL AFTER `production_commit_sha`,
  ADD COLUMN IF NOT EXISTS `production_promoted_at` DATETIME(3) NULL AFTER `production_promotion_authorization_id`,
  ADD COLUMN IF NOT EXISTS `deployment_attestation_id` CHAR(36) NULL AFTER `production_promoted_at`,
  ADD COLUMN IF NOT EXISTS `redeployed_at` DATETIME(3) NULL AFTER `deployment_attestation_id`,
  ADD COLUMN IF NOT EXISTS `clean_runtime_readback_json` JSON NULL AFTER `redeployed_at`,
  ADD COLUMN IF NOT EXISTS `clean_readback_at` DATETIME(3) NULL AFTER `clean_runtime_readback_json`,
  ADD COLUMN IF NOT EXISTS `closure_evidence_sha256` CHAR(64) NULL AFTER `clean_readback_at`;

CREATE INDEX IF NOT EXISTS `idx_runtime_break_glass_main_commit` ON `runtime_break_glass_incidents` (`main_commit_sha`);
CREATE INDEX IF NOT EXISTS `idx_runtime_break_glass_production_commit` ON `runtime_break_glass_incidents` (`production_commit_sha`);
CREATE INDEX IF NOT EXISTS `idx_runtime_break_glass_attestation` ON `runtime_break_glass_incidents` (`deployment_attestation_id`);
