-- Staging-local additive compatibility bridge for immutable migration 265.
-- The policy key is adapter_key plus a mode suffix; preserve the complete source domain.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_family_registry` (
  `family_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `delivery_scope` VARCHAR(64) NOT NULL DEFAULT 'support_ticket_notification',
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `dispatch_default_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_supported` TINYINT(1) NOT NULL DEFAULT 0,
  `description` TEXT NULL,
  `safety_json` JSON NULL,
  `sort_order` INT NOT NULL DEFAULT 1000,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`family_key`),
  KEY `idx_external_delivery_family_channel_status` (`channel`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_contract_registry` (
  `adapter_key` VARCHAR(160) NOT NULL,
  `family_key` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `implementation_status` VARCHAR(64) NOT NULL DEFAULT 'not_implemented',
  `dispatch_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `required_credential_type` VARCHAR(160) NULL,
  `supported_audiences_json` JSON NULL,
  `send_modes_json` JSON NULL,
  `payload_schema_json` JSON NULL,
  `preflight_schema_json` JSON NULL,
  `rate_limit_json` JSON NULL,
  `retry_policy_json` JSON NULL,
  `idempotency_policy_json` JSON NULL,
  `readback_policy_json` JSON NULL,
  `audit_policy_json` JSON NULL,
  `safety_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`adapter_key`),
  KEY `idx_external_delivery_adapter_family_status` (`family_key`, `status`),
  KEY `idx_external_delivery_adapter_channel_status` (`channel`, `status`),
  CONSTRAINT `fk_external_delivery_adapter_family` FOREIGN KEY (`family_key`) REFERENCES `external_delivery_provider_family_registry` (`family_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_delivery_provider_send_mode_policy_registry` (
  `policy_key` VARCHAR(255) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `mode_key` VARCHAR(80) NOT NULL,
  `mode_status` VARCHAR(64) NOT NULL DEFAULT 'allowed_readonly',
  `approval_required` TINYINT(1) NOT NULL DEFAULT 1,
  `credential_required` TINYINT(1) NOT NULL DEFAULT 1,
  `final_approval_required` TINYINT(1) NOT NULL DEFAULT 1,
  `provider_dispatch_required` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed_default` TINYINT(1) NOT NULL DEFAULT 0,
  `safety_json` JSON NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`),
  UNIQUE KEY `uq_external_delivery_send_mode_adapter_mode` (`adapter_key`, `mode_key`),
  KEY `idx_external_delivery_send_mode_status` (`mode_status`, `status`),
  CONSTRAINT `fk_external_delivery_send_mode_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS `external_delivery_provider_send_mode_policy_registry`
  MODIFY COLUMN `policy_key` VARCHAR(255) NOT NULL;
