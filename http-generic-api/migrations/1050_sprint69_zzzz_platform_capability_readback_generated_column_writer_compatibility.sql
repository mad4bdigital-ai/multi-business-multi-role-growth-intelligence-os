-- Staging-local additive compatibility bridge for immutable writers that explicitly assign current_contract_key.
-- MariaDB rejects values supplied for a generated column; this temporary ordinary shape keeps the historical
-- metadata writers replayable. The generated invariant is restored after the last explicit writer.
-- No data DML, provider access, credential access, runtime mutation, or Production action; secrets_included=false.

CREATE TABLE IF NOT EXISTS `platform_capability_readback_contracts` (
  `contract_id` VARCHAR(36) NOT NULL,
  `contract_key` VARCHAR(191) NOT NULL,
  `contract_version` INT UNSIGNED NOT NULL,
  `capability_key` VARCHAR(255) NOT NULL,
  `adapter_key` VARCHAR(191) NULL,
  `verification_type` VARCHAR(64) NOT NULL,
  `acknowledgement_required` TINYINT(1) NOT NULL DEFAULT 1,
  `verification_required` TINYINT(1) NOT NULL DEFAULT 1,
  `expected_effect_class` VARCHAR(64) NULL,
  `input_schema_json` LONGTEXT NULL,
  `observed_state_schema_json` LONGTEXT NOT NULL,
  `provider_binding_constraints_json` LONGTEXT NULL,
  `certification_status` ENUM('pending','certified','stale','revoked','not_required') NOT NULL DEFAULT 'pending',
  `status` ENUM('draft','shadow','certified','stale','revoked','disabled') NOT NULL DEFAULT 'draft',
  `is_current` TINYINT(1) NOT NULL DEFAULT 1,
  `current_contract_key` VARCHAR(191) NULL,
  `valid_from` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `source_registry` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`contract_id`),
  UNIQUE KEY `uq_pc_readback_contract_version` (`contract_key`, `contract_version`),
  UNIQUE KEY `uq_pc_readback_current_contract` (`current_contract_key`),
  KEY `idx_pc_readback_capability` (`capability_key`, `is_current`, `status`),
  KEY `idx_pc_readback_adapter` (`adapter_key`, `is_current`, `status`),
  KEY `idx_pc_readback_expiry` (`expires_at`),
  CONSTRAINT `chk_pc_readback_input_json` CHECK (`input_schema_json` IS NULL OR JSON_VALID(`input_schema_json`)),
  CONSTRAINT `chk_pc_readback_observed_json` CHECK (JSON_VALID(`observed_state_schema_json`)),
  CONSTRAINT `chk_pc_readback_provider_json` CHECK (`provider_binding_constraints_json` IS NULL OR JSON_VALID(`provider_binding_constraints_json`)),
  CONSTRAINT `chk_pc_readback_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS `platform_capability_readback_contracts`
  MODIFY COLUMN `current_contract_key` VARCHAR(191) NULL;
