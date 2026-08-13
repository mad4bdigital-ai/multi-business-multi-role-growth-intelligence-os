-- Spec 018 / Generated Deployment Attestation and Runtime Integrity
-- Additive evidence plane. This migration does not deploy, restart, promote, or mutate provider state.

CREATE TABLE IF NOT EXISTS `deployment_attestations` (
  `attestation_id` CHAR(36) NOT NULL,
  `environment_key` VARCHAR(64) NOT NULL,
  `repository_uri` VARCHAR(512) NOT NULL,
  `source_branch` VARCHAR(255) NOT NULL,
  `source_commit_sha` CHAR(40) NOT NULL,
  `build_id` VARCHAR(191) NOT NULL,
  `build_timestamp` DATETIME(3) NOT NULL,
  `canonical_registry_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `canonical_resource_hashes_json` JSON NOT NULL,
  `generation_policy_version` VARCHAR(64) NOT NULL,
  `attestation_sha256` CHAR(64) NOT NULL,
  `status` ENUM('generated','deployed','superseded','invalid') NOT NULL DEFAULT 'generated',
  `deployed_runtime_sha` CHAR(40) NULL,
  `runtime_integrity_state` ENUM('verified_clean','break_glass_active','degraded_unreconciled_change','verification_failed','unknown') NOT NULL DEFAULT 'unknown',
  `runtime_readback_json` JSON NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`attestation_id`),
  UNIQUE KEY `uq_deployment_attestation_sha` (`attestation_sha256`),
  KEY `idx_deployment_attestation_environment_commit` (`environment_key`,`source_commit_sha`,`status`),
  KEY `idx_deployment_attestation_runtime_integrity` (`environment_key`,`runtime_integrity_state`,`updated_at`),
  CONSTRAINT `chk_deployment_attestations_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
