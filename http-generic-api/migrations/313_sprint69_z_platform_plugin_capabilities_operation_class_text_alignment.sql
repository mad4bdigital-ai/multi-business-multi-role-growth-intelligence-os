-- Staging-local safety alignment: preserve descriptive operation_class values before
-- the immutable migration-314 canonical capability backfill.
-- Additive DDL only; no provider calls, credentials, runtime writes, or data export.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
CREATE TABLE IF NOT EXISTS `platform_plugin_capabilities` (
  `capability_key` VARCHAR(191) NOT NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `capability_family` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `operation_class` TEXT NOT NULL,
  `risk_class` VARCHAR(64) NOT NULL,
  `runtime_status` VARCHAR(64) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `authority_requirement_type` ENUM('none','invocation','resource','approval','quota','combined') NOT NULL DEFAULT 'none',
  `resource_authority_required` TINYINT(1) NOT NULL DEFAULT 0,
  `dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_audit_evidence` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_readback` TINYINT(1) NOT NULL DEFAULT 0,
  `legacy_evidence_ref` VARCHAR(255) NULL,
  `metadata_json` LONGTEXT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`capability_key`),
  KEY `idx_ppc_plugin_status` (`plugin_key`, `status`),
  KEY `idx_ppc_authority` (`authority_requirement_type`, `resource_authority_required`),
  KEY `idx_ppc_dispatch_apply` (`dispatch_allowed`, `apply_allowed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
