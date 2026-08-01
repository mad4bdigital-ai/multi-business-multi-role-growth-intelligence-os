-- Spec 011 T403: immutable compiled policy and workflow-plan snapshots.
-- Additive, append-only persistence only. This migration is not applied by the PR.
-- No provider calls, credential reads, external sends, runtime deployment, or production activation.

CREATE TABLE IF NOT EXISTS `growth_control_compiled_policy_snapshots` (
  `policy_snapshot_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `workspace_id` VARCHAR(36) NOT NULL,
  `brand_key` VARCHAR(255) NOT NULL,
  `activity_binding_id` CHAR(36) NOT NULL,
  `workflow_key` VARCHAR(255) NOT NULL,
  `workflow_version` INT UNSIGNED NOT NULL,
  `policy_versions_json` LONGTEXT NOT NULL,
  `policy_snapshot_json` LONGTEXT NOT NULL,
  `policy_hash_sha256` CHAR(64) NOT NULL,
  `version_set_hash_sha256` CHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `provider_calls` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_writes` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`policy_snapshot_id`),
  UNIQUE KEY `uq_gc_policy_snapshot_idempotency` (`idempotency_key`),
  KEY `idx_gc_policy_snapshot_scope` (`tenant_id`,`workspace_id`,`brand_key`,`activity_binding_id`,`created_at`),
  KEY `idx_gc_policy_snapshot_workflow` (`workflow_key`,`workflow_version`,`created_at`),
  KEY `idx_gc_policy_snapshot_hash` (`policy_hash_sha256`,`version_set_hash_sha256`),
  CONSTRAINT `fk_gc_policy_snapshot_binding`
    FOREIGN KEY (`activity_binding_id`) REFERENCES `growth_control_brand_activity_bindings` (`activity_binding_id`),
  CONSTRAINT `chk_gc_policy_snapshot_hash`
    CHECK (CHAR_LENGTH(`policy_hash_sha256`) = 64 AND `policy_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_policy_version_set_hash`
    CHECK (CHAR_LENGTH(`version_set_hash_sha256`) = 64 AND `version_set_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_policy_snapshot_no_effects`
    CHECK (`provider_calls` = 0 AND `provider_dispatch_allowed` = 0 AND `provider_apply_allowed` = 0 AND `external_writes` = 0),
  CONSTRAINT `chk_gc_policy_snapshot_no_secrets`
    CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `growth_control_compiled_plan_snapshots` (
  `plan_snapshot_id` CHAR(36) NOT NULL,
  `policy_snapshot_id` CHAR(36) NOT NULL,
  `config_resolution_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `workspace_id` VARCHAR(36) NOT NULL,
  `brand_key` VARCHAR(255) NOT NULL,
  `activity_binding_id` CHAR(36) NOT NULL,
  `activity_pack_version_id` CHAR(36) NULL,
  `workflow_key` VARCHAR(255) NOT NULL,
  `workflow_version` INT UNSIGNED NOT NULL,
  `resolved_versions_json` LONGTEXT NOT NULL,
  `plan_snapshot_json` LONGTEXT NOT NULL,
  `config_hash_sha256` CHAR(64) NOT NULL,
  `policy_hash_sha256` CHAR(64) NOT NULL,
  `plan_hash_sha256` CHAR(64) NOT NULL,
  `version_set_hash_sha256` CHAR(64) NOT NULL,
  `bundle_hash_sha256` CHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `immutable` TINYINT(1) NOT NULL DEFAULT 1,
  `provider_calls` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_writes` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`plan_snapshot_id`),
  UNIQUE KEY `uq_gc_plan_snapshot_idempotency` (`idempotency_key`),
  KEY `idx_gc_plan_snapshot_scope` (`tenant_id`,`workspace_id`,`brand_key`,`activity_binding_id`,`created_at`),
  KEY `idx_gc_plan_snapshot_workflow` (`workflow_key`,`workflow_version`,`created_at`),
  KEY `idx_gc_plan_snapshot_bundle` (`bundle_hash_sha256`,`created_at`),
  KEY `idx_gc_plan_snapshot_config` (`config_resolution_id`,`config_hash_sha256`),
  CONSTRAINT `fk_gc_plan_snapshot_policy`
    FOREIGN KEY (`policy_snapshot_id`) REFERENCES `growth_control_compiled_policy_snapshots` (`policy_snapshot_id`),
  CONSTRAINT `fk_gc_plan_snapshot_config`
    FOREIGN KEY (`config_resolution_id`) REFERENCES `growth_control_config_resolution_snapshots` (`resolution_id`),
  CONSTRAINT `fk_gc_plan_snapshot_binding`
    FOREIGN KEY (`activity_binding_id`) REFERENCES `growth_control_brand_activity_bindings` (`activity_binding_id`),
  CONSTRAINT `chk_gc_plan_config_hash`
    CHECK (CHAR_LENGTH(`config_hash_sha256`) = 64 AND `config_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_plan_policy_hash`
    CHECK (CHAR_LENGTH(`policy_hash_sha256`) = 64 AND `policy_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_plan_hash`
    CHECK (CHAR_LENGTH(`plan_hash_sha256`) = 64 AND `plan_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_plan_version_set_hash`
    CHECK (CHAR_LENGTH(`version_set_hash_sha256`) = 64 AND `version_set_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_plan_bundle_hash`
    CHECK (CHAR_LENGTH(`bundle_hash_sha256`) = 64 AND `bundle_hash_sha256` NOT REGEXP '[^0-9a-f]'),
  CONSTRAINT `chk_gc_plan_snapshot_immutable`
    CHECK (`immutable` = 1),
  CONSTRAINT `chk_gc_plan_snapshot_no_effects`
    CHECK (`provider_calls` = 0 AND `provider_dispatch_allowed` = 0 AND `provider_apply_allowed` = 0 AND `external_writes` = 0),
  CONSTRAINT `chk_gc_plan_snapshot_no_secrets`
    CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,
   `requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('20260731_growth_control_plan_snapshot_persistence.sql','authorized','spec_011_implementation',
   'governed_migration_runner_authorization_v1','high',1,1,1,1,
   'Additive append-only Spec 011 T403 snapshot persistence. No provider or external effects.',
   JSON_OBJECT(
     'spec_key','011-dynamic-multi-tenant-growth-control-plane',
     'task_key','T403',
     'additive_only',true,
     'append_only',true,
     'provider_writes',false,
     'external_sends',false
   ))
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
