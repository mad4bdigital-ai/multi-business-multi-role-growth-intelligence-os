-- Spec 007: Dynamic Capability Governance persistence foundation.
-- Additive internal registry storage only; canonical capability authority remains platform_plugin_capabilities.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- no_tenant_authority_change
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `platform_capability_compilation_runs` (
  `run_id` VARCHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `compiler_version` VARCHAR(128) NOT NULL,
  `mode` ENUM('shadow_persist') NOT NULL DEFAULT 'shadow_persist',
  `status` ENUM('running','complete','failed') NOT NULL DEFAULT 'running',
  `source_revision_hash` CHAR(64) NOT NULL,
  `input_hash` CHAR(64) NOT NULL,
  `output_hash` CHAR(64) NULL,
  `filters_json` LONGTEXT NULL,
  `source_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `compiled_manifest_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `persisted_manifest_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `reused_manifest_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `gap_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `blocked_manifest_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `shadow_ready_manifest_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `requested_by` VARCHAR(191) NULL,
  `capability_envelope_id` VARCHAR(64) NOT NULL,
  `error_code` VARCHAR(128) NULL,
  `error_message` VARCHAR(1000) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uq_pcgr_idempotency_key` (`idempotency_key`),
  KEY `idx_pcgr_status_started` (`status`,`started_at`),
  KEY `idx_pcgr_source_revision` (`source_revision_hash`,`started_at`),
  KEY `idx_pcgr_compiler_version` (`compiler_version`,`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_compiled_manifests` (
  `manifest_id` VARCHAR(36) NOT NULL,
  `run_id` VARCHAR(36) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `manifest_version` INT UNSIGNED NOT NULL,
  `manifest_hash` CHAR(64) NOT NULL,
  `source_revision_hash` CHAR(64) NOT NULL,
  `compiler_version` VARCHAR(128) NOT NULL,
  `effect_class` VARCHAR(64) NOT NULL,
  `risk_class` CHAR(1) NOT NULL,
  `authority_requirement_type` VARCHAR(64) NOT NULL DEFAULT 'none',
  `status` ENUM('blocked','shadow_ready','invalid','superseded','revoked') NOT NULL,
  `rollout_mode` ENUM('disabled','shadow','canary','active','fallback') NOT NULL DEFAULT 'disabled',
  `manifest_json` LONGTEXT NOT NULL,
  `is_current` TINYINT(1) NOT NULL DEFAULT 1,
  `current_capability_key` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN `is_current` = 1 THEN `capability_key` ELSE NULL END) STORED,
  `superseded_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`manifest_id`),
  UNIQUE KEY `uq_pccm_capability_version` (`capability_key`,`manifest_version`),
  UNIQUE KEY `uq_pccm_current_capability` (`current_capability_key`),
  UNIQUE KEY `uq_pccm_source_manifest` (`capability_key`,`source_revision_hash`,`manifest_hash`),
  KEY `idx_pccm_run` (`run_id`,`capability_key`),
  KEY `idx_pccm_status_effect` (`status`,`effect_class`,`risk_class`),
  KEY `idx_pccm_hash` (`manifest_hash`),
  CONSTRAINT `fk_pccm_run` FOREIGN KEY (`run_id`) REFERENCES `platform_capability_compilation_runs` (`run_id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_manifest_source_links` (
  `source_link_id` VARCHAR(36) NOT NULL,
  `manifest_id` VARCHAR(36) NOT NULL,
  `source_table` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `source_revision_hash` CHAR(64) NOT NULL,
  `source_hash` CHAR(64) NOT NULL,
  `source_metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`source_link_id`),
  UNIQUE KEY `uq_pcmsl_manifest_source` (`manifest_id`,`source_table`,`source_key`),
  KEY `idx_pcmsl_source_lookup` (`source_table`,`source_key`),
  KEY `idx_pcmsl_revision` (`source_revision_hash`),
  CONSTRAINT `fk_pcmsl_manifest` FOREIGN KEY (`manifest_id`) REFERENCES `platform_capability_compiled_manifests` (`manifest_id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_governance_gap_snapshots` (
  `gap_snapshot_id` VARCHAR(36) NOT NULL,
  `run_id` VARCHAR(36) NOT NULL,
  `manifest_id` VARCHAR(36) NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `gap_key` VARCHAR(191) NOT NULL,
  `gap_severity` ENUM('low','medium','high','critical') NOT NULL,
  `gap_description` VARCHAR(1000) NOT NULL,
  `blocks_dispatch` TINYINT(1) NOT NULL DEFAULT 0,
  `gap_fingerprint` CHAR(64) NOT NULL,
  `source_table` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `snapshot_status` ENUM('observed') NOT NULL DEFAULT 'observed',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`gap_snapshot_id`),
  UNIQUE KEY `uq_pcggs_run_fingerprint` (`run_id`,`gap_fingerprint`),
  KEY `idx_pcggs_capability_severity` (`capability_key`,`gap_severity`,`created_at`),
  KEY `idx_pcggs_gap_key_severity` (`gap_key`,`gap_severity`,`created_at`),
  KEY `idx_pcggs_run_blocks` (`run_id`,`blocks_dispatch`),
  CONSTRAINT `fk_pcggs_run` FOREIGN KEY (`run_id`) REFERENCES `platform_capability_compilation_runs` (`run_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_pcggs_manifest` FOREIGN KEY (`manifest_id`) REFERENCES `platform_capability_compiled_manifests` (`manifest_id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_platform_capability_governance_persistence_summary` AS
SELECT
  (SELECT COUNT(*) FROM platform_capability_compilation_runs) AS compilation_run_count,
  (SELECT COUNT(*) FROM platform_capability_compilation_runs WHERE status='complete') AS complete_run_count,
  (SELECT COUNT(*) FROM platform_capability_compiled_manifests) AS manifest_history_count,
  (SELECT COUNT(*) FROM platform_capability_compiled_manifests WHERE is_current=1) AS current_manifest_count,
  (SELECT COUNT(*) FROM platform_capability_governance_gap_snapshots) AS gap_snapshot_count,
  (SELECT COUNT(*) FROM platform_capability_governance_gap_snapshots WHERE blocks_dispatch=1) AS blocking_gap_snapshot_count,
  0 AS runtime_enforcement_enabled,
  0 AS provider_calls_enabled,
  0 AS tenant_authority_changes_enabled,
  0 AS secrets_included;

INSERT INTO `platform_closure_threads`
  (`thread_key`,`state`,`required_evidence_json`,`observed_evidence_json`,`blocker_json`,`next_action`,`owner_engine_key`)
VALUES
  ('dynamic_capability_governance_persistence','validating',
   JSON_ARRAY('migration_schema_readback','compiler_persistence_transaction_tests','idempotency_replay_tests','live_shadow_persist_readback'),
   JSON_ARRAY('spec_007_dynamic_capability_governance','compiler_v3_live_shadow_evidence'),JSON_ARRAY(),
   'Persist one bounded shadow compilation batch and verify immutable manifests, source links, gap snapshots, and no-secret guarantees.','resource_authority_engine')
ON DUPLICATE KEY UPDATE
  state=VALUES(state),required_evidence_json=VALUES(required_evidence_json),observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),next_action=VALUES(next_action),owner_engine_key=VALUES(owner_engine_key),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,`requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('20260630_dynamic_capability_governance_persistence.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize additive Spec 007 compilation run, immutable manifest, provenance link, and typed gap snapshot storage. No runtime enforcement or provider execution.',
   JSON_OBJECT('scope','dynamic_capability_governance_persistence','canonical_capability_authority','platform_plugin_capabilities',
               'runtime_enforcement',false,'provider_calls',false,'tenant_authority_changes',false,'external_writes',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
