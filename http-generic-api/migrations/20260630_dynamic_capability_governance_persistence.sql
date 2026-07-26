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

INSERT INTO `platform_plugins`
  (`plugin_key`,`display_name`,`plugin_family`,`source_kind`,`owner_scope`,`trust_level`,`status`,`source_table`,`source_key`,`manifest_json`)
VALUES
  ('platform_orchestration','Platform Orchestration','orchestration_intelligence','canonical_registry','internal','governed','active',
   'app_integrations','platform_orchestration',
   JSON_OBJECT('credential_source','none','provider_calls_allowed',false,'external_writes_allowed',false,'tenant_authority_changes_allowed',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),plugin_family=VALUES(plugin_family),owner_scope=VALUES(owner_scope),
  trust_level=VALUES(trust_level),status=VALUES(status),source_table=VALUES(source_table),source_key=VALUES(source_key),
  manifest_json=VALUES(manifest_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capabilities`
  (`capability_key`,`plugin_key`,`display_name`,`capability_family`,`source_table`,`source_key`,`operation_class`,`risk_class`,
   `runtime_status`,`exposure_scope`,`authority_requirement_type`,`resource_authority_required`,`dispatch_allowed`,`apply_allowed`,
   `requires_audit_evidence`,`requires_readback`,`legacy_evidence_ref`,`metadata_json`,`status`)
VALUES
  ('platform_capability_governance_compile_persist','platform_orchestration',
   'Persist Platform Capability Governance Compilation','capability_governance','virtual_admin_tools',
   'platform_capability_governance_compile_persist','internal_write','C','shadow','admin','approval',0,1,0,1,1,
   'migration:20260630_dynamic_capability_governance_persistence.sql',
   JSON_OBJECT('typed_confirmation','PERSIST_CAPABILITY_GOVERNANCE_COMPILATION','idempotency_required',true,
               'expected_source_revision_required',true,'same_cycle_readback',true,'provider_calls',false,
               'external_writes',false,'tenant_authority_changes',false,'secrets_included',false),'active')
ON DUPLICATE KEY UPDATE
  plugin_key=VALUES(plugin_key),display_name=VALUES(display_name),capability_family=VALUES(capability_family),
  source_table=VALUES(source_table),source_key=VALUES(source_key),operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
  runtime_status=VALUES(runtime_status),exposure_scope=VALUES(exposure_scope),authority_requirement_type=VALUES(authority_requirement_type),
  resource_authority_required=VALUES(resource_authority_required),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  legacy_evidence_ref=VALUES(legacy_evidence_ref),metadata_json=VALUES(metadata_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_bindings`
  (`binding_key`,`capability_key`,`binding_family`,`source_table`,`source_key`,`binding_status`,`exposure_scope`,
   `credential_source`,`dispatch_allowed`,`apply_allowed`,`metadata_json`)
VALUES
  ('binding:admin:platform_capability_governance_compile_persist','platform_capability_governance_compile_persist',
   'admin_virtual_tool','virtual_admin_tools','platform_capability_governance_compile_persist','active','admin','none',1,0,
   JSON_OBJECT('runtime_surface','platform_capability_governance_compile_persist','capability_envelope_required',true,
               'typed_confirmation_required',true,'same_cycle_readback',true,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capability_exports`
  (`export_key`,`capability_key`,`export_surface`,`source_table`,`source_key`,`export_status`,`exposure_scope`,`http_method`,`http_path`,`notes`)
VALUES
  ('export:admin:platform_capability_governance_compile_persist','platform_capability_governance_compile_persist',
   'admin_virtual_tool','virtual_admin_tools','platform_capability_governance_compile_persist','active','admin','VIRTUAL',
   'internal://platform-capability-governance-compile-persist',
   'Admin-only internal registry persistence. Requires approved apply-authorized platform_orchestration envelope and same-cycle readback.')
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_action_bindings`
  (`binding_id`,`app_key`,`action_key`,`binding_role`,`credential_source`,`exposure_default`,`status`,`notes`)
VALUES
  ('bind_action_platform_capability_governance_compile_persist','platform_orchestration',
   'platform_capability_governance_compile_persist','resolver','none','manual_tools','active',
   'Internal no-credential governed persistence for immutable capability manifests and typed gap snapshots.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),action_key=VALUES(action_key),binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),exposure_default=VALUES(exposure_default),status=VALUES(status),
  notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings`
  (`binding_id`,`app_key`,`tool_key`,`tool_surface`,`binding_role`,`credential_source`,`exposure_scope`,`status`,`notes`)
VALUES
  ('bind_tool_platform_capability_governance_compile_persist','platform_orchestration',
   'platform_capability_governance_compile_persist','admin_platform_tool','state_changing','none','admin','active',
   'Apply-authorized internal registry write only. No provider calls, external writes, Tenant authority changes, or secrets.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),tool_key=VALUES(tool_key),tool_surface=VALUES(tool_surface),binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),exposure_scope=VALUES(exposure_scope),status=VALUES(status),
  notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`,`surface_key`,`surface_family`,`tool_or_action_key`,`risk_class`,`certification_status`,`smoke_strategy`,
   `dispatch_allowed`,`apply_allowed`,`requires_resource_authority`,`requires_dry_run`,`requires_audit_evidence`,`requires_readback`,
   `last_evidence_ref`,`last_certified_at`,`expires_at`,`notes`)
VALUES
  ('platform_capability_governance_compile_persist','platform_capability_governance_compile_persist','capability_governance',
   'platform_capability_governance_compile_persist','C','migration_registered_apply_envelope_required',
   'bounded_shadow_compile_persist_same_cycle_readback',1,0,0,1,1,1,
   'migration:20260630_dynamic_capability_governance_persistence.sql',CURRENT_TIMESTAMP,NULL,
   'Dispatch is registered for Admin orchestration. Apply remains gated by capability_apply_authorization_policy_registry and runtime envelope verification.')
ON DUPLICATE KEY UPDATE
  certification_status=VALUES(certification_status),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority),requires_dry_run=VALUES(requires_dry_run),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  last_evidence_ref=VALUES(last_evidence_ref),last_certified_at=VALUES(last_certified_at),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`,`app_key`,`capability_key`,`operation_intent`,`runtime_surface`,`status`,`allow_external_write`,
   `allow_credential_binding`,`allow_no_credential_binding`,`requires_ready_for_dispatch`,`requires_dispatch_allowed`,
   `requires_zero_blocking_gaps`,`requires_audit_evidence`,`requires_readback`,`requires_typed_confirmation`,
   `requires_same_cycle_dry_run`,`allowed_source_tiers_json`,`policy_json`,`notes`)
VALUES
  ('platform_capability_governance_compile_persist_apply_v1','platform_orchestration',
   'platform_capability_governance_compile_persist','platform_capability_governance_compile_persist',
   'platform_capability_governance_compile_persist','active',0,0,1,1,1,1,1,1,1,1,
   JSON_ARRAY('platform_managed_fallback','tenant_managed'),
   JSON_OBJECT('external_write_allowed',false,'provider_call_allowed',false,'credential_payload_read_allowed',false,
               'tenant_authority_change_allowed',false,'internal_registry_write_expected',true,
               'typed_confirmation','PERSIST_CAPABILITY_GOVERNANCE_COMPILATION',
               'source_revision_match_required',true,'idempotency_required',true,'same_cycle_readback',true,
               'secrets_included',false),
   'Authorize bounded immutable governance compilation persistence only after preview/source-revision validation and explicit typed confirmation.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),capability_key=VALUES(capability_key),operation_intent=VALUES(operation_intent),
  runtime_surface=VALUES(runtime_surface),status=VALUES(status),allow_external_write=VALUES(allow_external_write),
  allow_credential_binding=VALUES(allow_credential_binding),allow_no_credential_binding=VALUES(allow_no_credential_binding),
  requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch),requires_dispatch_allowed=VALUES(requires_dispatch_allowed),
  requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps),requires_audit_evidence=VALUES(requires_audit_evidence),
  requires_readback=VALUES(requires_readback),requires_typed_confirmation=VALUES(requires_typed_confirmation),
  requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run),allowed_source_tiers_json=VALUES(allowed_source_tiers_json),
  policy_json=VALUES(policy_json),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
SELECT
  'Dynamic Capability Governance','platform_capability_governance_compile_persist_policy_v1',
  JSON_OBJECT('rule','platform_capability_governance_compile_persist','tool_key','platform_capability_governance_compile_persist',
              'requires',JSON_ARRAY('approved_capability_envelope','apply_allowed','expected_source_revision_hash',
                                    'typed_confirmation','idempotency_key','same_cycle_readback'),
              'writes_tables',JSON_ARRAY('platform_capability_compilation_runs','platform_capability_compiled_manifests',
                                         'platform_capability_manifest_source_links','platform_capability_governance_gap_snapshots'),
              'no_provider_call',true,'no_external_write',true,'no_tenant_authority_change',true,'secrets_included',false),
  'TRUE','gpt_tools_call|tool_dispatch|platform_capability_governance_compile_persist|internal_registry_write',
  'gptToolsRoutes|dynamicCapabilityGovernancePersistence|platform_capability_compilation_runs|platform_capability_compiled_manifests|platform_capability_manifest_source_links|platform_capability_governance_gap_snapshots',
  'TRUE','Blocking internal persistence policy. Runtime must validate envelope, source revision, typed confirmation, idempotency, transaction, and same-cycle readback.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Dynamic Capability Governance'
     AND `policy_key`='platform_capability_governance_compile_persist_policy_v1'
);

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
