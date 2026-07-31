-- Spec 011: Dynamic Growth Control Plane foundation.
-- Additive registry and draft-only control-plane persistence.
-- No provider calls, credential reads, external sends, or production activation.

CREATE TABLE IF NOT EXISTS `growth_control_config_definitions` (
  `config_key` VARCHAR(128) NOT NULL,
  `schema_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `schema_json` LONGTEXT NOT NULL,
  `default_values_json` LONGTEXT NULL,
  `allowed_scopes_json` LONGTEXT NOT NULL,
  `merge_profile_json` LONGTEXT NOT NULL,
  `security_classification` ENUM('public_metadata','tenant_internal','restricted','security_control') NOT NULL DEFAULT 'tenant_internal',
  `status` ENUM('draft','active','blocked','deprecated','archived') NOT NULL DEFAULT 'draft',
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `checksum_sha256` CHAR(64) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`config_key`),
  KEY `idx_growth_config_definition_status` (`status`,`updated_at`),
  CONSTRAINT `chk_growth_config_definition_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_config_versions` (
  `config_version_id` CHAR(36) NOT NULL,
  `config_key` VARCHAR(128) NOT NULL,
  `version_number` INT UNSIGNED NOT NULL,
  `scope_type` ENUM('platform','activity','tenant','workspace','brand','profile','workflow','workflow_node','plan','execution') NOT NULL,
  `scope_key` VARCHAR(700) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(36) NULL,
  `brand_key` VARCHAR(255) NULL,
  `activity_type_key` VARCHAR(255) NULL,
  `activity_binding_id` CHAR(36) NULL,
  `profile_key` VARCHAR(191) NULL,
  `workflow_key` VARCHAR(255) NULL,
  `workflow_version` INT UNSIGNED NULL,
  `workflow_node_id` VARCHAR(191) NULL,
  `plan_id` VARCHAR(191) NULL,
  `execution_id` VARCHAR(191) NULL,
  `values_json` LONGTEXT NOT NULL,
  `lifecycle` ENUM('draft','validating','ready','active','blocked','deprecated','archived','rolled_back') NOT NULL DEFAULT 'draft',
  `version_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `supersedes_version_id` CHAR(36) NULL,
  `effective_from` DATETIME NULL,
  `effective_to` DATETIME NULL,
  `checksum_sha256` CHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `approved_by` VARCHAR(128) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`config_version_id`),
  UNIQUE KEY `uq_growth_config_scope_version` (`config_key`,`scope_key`,`version_number`),
  UNIQUE KEY `uq_growth_config_idempotency` (`idempotency_key`),
  KEY `idx_growth_config_resolution` (`config_key`,`scope_key`,`lifecycle`,`version_number`),
  KEY `idx_growth_config_tenant_brand` (`tenant_id`,`workspace_id`,`brand_key`,`activity_type_key`),
  CONSTRAINT `chk_growth_config_version_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_config_resolution_snapshots` (
  `resolution_id` CHAR(36) NOT NULL,
  `config_key` VARCHAR(128) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(36) NULL,
  `brand_key` VARCHAR(255) NULL,
  `activity_type_key` VARCHAR(255) NULL,
  `activity_binding_id` CHAR(36) NULL,
  `workflow_key` VARCHAR(255) NULL,
  `workflow_version` INT UNSIGNED NULL,
  `plan_id` VARCHAR(191) NULL,
  `execution_id` VARCHAR(191) NULL,
  `resolved_values_json` LONGTEXT NOT NULL,
  `lineage_json` LONGTEXT NOT NULL,
  `revision_vector_json` LONGTEXT NOT NULL,
  `conflicts_json` LONGTEXT NOT NULL,
  `resolved_sha256` CHAR(64) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `resolved_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`resolution_id`),
  KEY `idx_growth_resolution_context` (`config_key`,`tenant_id`,`workspace_id`,`brand_key`,`resolved_at`),
  KEY `idx_growth_resolution_sha` (`resolved_sha256`),
  CONSTRAINT `chk_growth_resolution_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_activity_pack_definitions` (
  `activity_pack_key` VARCHAR(128) NOT NULL,
  `activity_type_key` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('draft','active','blocked','deprecated','archived') NOT NULL DEFAULT 'draft',
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`activity_pack_key`),
  KEY `idx_growth_activity_pack_type` (`activity_type_key`,`status`),
  CONSTRAINT `chk_growth_activity_pack_definition_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_activity_pack_versions` (
  `activity_pack_version_id` CHAR(36) NOT NULL,
  `activity_pack_key` VARCHAR(128) NOT NULL,
  `version_number` INT UNSIGNED NOT NULL,
  `manifest_json` LONGTEXT NOT NULL,
  `checksum_sha256` CHAR(64) NOT NULL,
  `lifecycle` ENUM('draft','validating','ready','active','blocked','deprecated','archived','rolled_back') NOT NULL DEFAULT 'draft',
  `idempotency_key` VARCHAR(191) NOT NULL,
  `supersedes_version_id` CHAR(36) NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `approved_by` VARCHAR(128) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`activity_pack_version_id`),
  UNIQUE KEY `uq_growth_activity_pack_version` (`activity_pack_key`,`version_number`),
  UNIQUE KEY `uq_growth_activity_pack_idempotency` (`idempotency_key`),
  KEY `idx_growth_activity_pack_lifecycle` (`activity_pack_key`,`lifecycle`,`version_number`),
  CONSTRAINT `chk_growth_activity_pack_version_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_brand_activity_bindings` (
  `activity_binding_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `workspace_id` VARCHAR(36) NOT NULL,
  `brand_key` VARCHAR(255) NOT NULL,
  `activity_type_key` VARCHAR(255) NOT NULL,
  `activity_pack_key` VARCHAR(128) NOT NULL,
  `activity_pack_version` INT UNSIGNED NOT NULL,
  `markets_json` LONGTEXT NOT NULL,
  `locales_json` LONGTEXT NOT NULL,
  `channels_json` LONGTEXT NOT NULL,
  `objectives_json` LONGTEXT NOT NULL,
  `allowed_capabilities_json` LONGTEXT NOT NULL,
  `status` ENUM('draft','validating','ready','active','blocked','deprecated','archived') NOT NULL DEFAULT 'draft',
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `approved_by` VARCHAR(128) NULL,
  `effective_from` DATETIME NULL,
  `effective_to` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`activity_binding_id`),
  UNIQUE KEY `uq_growth_brand_activity_idempotency` (`idempotency_key`),
  KEY `idx_growth_brand_activity_context` (`tenant_id`,`workspace_id`,`brand_key`,`activity_type_key`,`status`),
  KEY `idx_growth_brand_activity_pack` (`activity_pack_key`,`activity_pack_version`),
  CONSTRAINT `chk_growth_brand_activity_binding_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_outbox_event_types`
  (`event_type`,`aggregate_type`,`current_schema_version`,`description`,`active`)
VALUES
  ('growth_control.configuration.activated','growth_control_configuration',1,
   'A Growth Control Plane configuration version became active and dependent caches or projections must invalidate.',1),
  ('growth_control.configuration.rolled_back','growth_control_configuration',1,
   'A Growth Control Plane configuration version was restored through an approved rollback and dependent caches or projections must invalidate.',1)
ON DUPLICATE KEY UPDATE
  `aggregate_type`=VALUES(`aggregate_type`),
  `current_schema_version`=VALUES(`current_schema_version`),
  `description`=VALUES(`description`),
  `active`=VALUES(`active`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,
   `requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('20260720_dynamic_growth_control_plane_foundation.sql','authorized','spec_011_implementation',
   'governed_migration_runner_authorization_v1','high',1,1,1,1,
   'Additive Spec 011 Growth Control Plane foundation. No provider or external effects.',
   JSON_OBJECT('spec_key','011-dynamic-multi-tenant-growth-control-plane','additive_only',true,'provider_writes',false,'external_sends',false))
ON DUPLICATE KEY UPDATE
  `authorization_status`=VALUES(`authorization_status`),
  `authorization_source`=VALUES(`authorization_source`),
  `policy_key`=VALUES(`policy_key`),
  `risk_tier`=VALUES(`risk_tier`),
  `requires_preflight`=VALUES(`requires_preflight`),
  `requires_confirmation`=VALUES(`requires_confirmation`),
  `allow_record_only`=VALUES(`allow_record_only`),
  `allow_apply`=VALUES(`allow_apply`),
  `notes`=VALUES(`notes`),
  `metadata_json`=VALUES(`metadata_json`),
  `updated_at`=CURRENT_TIMESTAMP;
