-- Spec Kit 006 implementation slice 3: authority scope shadow evidence.
-- Additive audit/readback storage only. No enforcement change.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `authority_scope_shadow_evidence` (
  `evidence_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `request_id` VARCHAR(191) NULL,
  `resolution_id` VARCHAR(64) NOT NULL,
  `principal_type` VARCHAR(64) NOT NULL,
  `principal_id` VARCHAR(191) NOT NULL,
  `target_container_id` VARCHAR(64) NOT NULL,
  `scope_id` VARCHAR(64) NULL,
  `scope_key` VARCHAR(191) NULL,
  `scope_type` VARCHAR(32) NULL,
  `scope_tenant_id` VARCHAR(36) NULL,
  `status` ENUM('resolved','unresolved') NOT NULL,
  `comparison_status` ENUM('match','mismatch','unresolved') NOT NULL,
  `mismatch_codes_json` LONGTEXT NULL,
  `enforcement_mode` ENUM('shadow_only') NOT NULL DEFAULT 'shadow_only',
  `authority_granted` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_call_made` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `duration_ms` DECIMAL(12,3) NULL,
  `error_code` VARCHAR(191) NULL,
  `error_status` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`evidence_id`),
  UNIQUE KEY `uq_authority_scope_shadow_resolution` (`resolution_id`),
  KEY `idx_authority_scope_shadow_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_authority_scope_shadow_comparison_created` (`comparison_status`,`created_at`),
  KEY `idx_authority_scope_shadow_scope_key` (`scope_key`),
  CONSTRAINT `chk_authority_scope_shadow_non_authoritative`
    CHECK (
      `enforcement_mode` = 'shadow_only'
      AND `authority_granted` = 0
      AND `provider_call_made` = 0
      AND `credential_payload_read` = 0
      AND `secrets_included` = 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
