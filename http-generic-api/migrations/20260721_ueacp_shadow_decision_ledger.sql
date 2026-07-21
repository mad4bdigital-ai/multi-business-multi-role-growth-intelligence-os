-- Spec Kit 011 implementation slice: unified effective authority shadow evidence.
-- Additive audit/readback storage only. No enforcement change.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `effective_authority_shadow_decisions` (
  `decision_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `principal_type` VARCHAR(64) NOT NULL,
  `principal_id` VARCHAR(191) NOT NULL,
  `subject_scope_id` VARCHAR(64) NULL,
  `subject_scope_key` VARCHAR(191) NOT NULL,
  `subject_scope_type` VARCHAR(32) NOT NULL,
  `subject_tenant_id` VARCHAR(36) NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_key` VARCHAR(255) NOT NULL,
  `decision` VARCHAR(64) NOT NULL,
  `enforcement_mode` ENUM('shadow_only') NOT NULL DEFAULT 'shadow_only',
  `authority_granted` TINYINT(1) NOT NULL DEFAULT 0,
  `manifest_sha256` CHAR(64) NOT NULL,
  `manifest_json` LONGTEXT NOT NULL,
  `readiness_json` LONGTEXT NOT NULL,
  `projection_eligibility_json` LONGTEXT NOT NULL,
  `gaps_json` LONGTEXT NOT NULL,
  `versions_json` LONGTEXT NOT NULL,
  `provider_call_made` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `external_write_made` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `evidence_source` VARCHAR(64) NOT NULL DEFAULT 'ueacp_runtime',
  `persistence_mode` ENUM('best_effort','required') NOT NULL,
  `evaluated_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`decision_id`),
  KEY `idx_effective_authority_shadow_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_effective_authority_shadow_principal_created` (`principal_id`,`created_at`),
  KEY `idx_effective_authority_shadow_capability_created` (`capability_key`,`created_at`),
  KEY `idx_effective_authority_shadow_resource_created` (`resource_type`,`resource_key`,`created_at`),
  CONSTRAINT `chk_effective_authority_shadow_non_authoritative`
    CHECK (
      `enforcement_mode` = 'shadow_only'
      AND `authority_granted` = 0
      AND `provider_call_made` = 0
      AND `credential_payload_read` = 0
      AND `external_write_made` = 0
      AND `secrets_included` = 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `authority_projection_drift_events` (
  `drift_event_id` VARCHAR(64) NOT NULL,
  `decision_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `projection_key` VARCHAR(128) NOT NULL,
  `issue_code` VARCHAR(191) NOT NULL,
  `registered_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `authorized_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `projected_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `executable_candidate_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `details_json` LONGTEXT NOT NULL,
  `status` ENUM('open','resolved','ignored') NOT NULL DEFAULT 'open',
  `enforcement_mode` ENUM('shadow_only') NOT NULL DEFAULT 'shadow_only',
  `authority_granted` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_call_made` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `external_write_made` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `detected_at` DATETIME(3) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`drift_event_id`),
  UNIQUE KEY `uq_authority_projection_drift_decision_issue`
    (`decision_id`,`projection_key`,`issue_code`),
  KEY `idx_authority_projection_drift_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_authority_projection_drift_status_created` (`status`,`created_at`),
  KEY `idx_authority_projection_drift_projection_created` (`projection_key`,`created_at`),
  CONSTRAINT `chk_authority_projection_drift_non_authoritative`
    CHECK (
      `enforcement_mode` = 'shadow_only'
      AND `authority_granted` = 0
      AND `provider_call_made` = 0
      AND `credential_payload_read` = 0
      AND `external_write_made` = 0
      AND `secrets_included` = 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
