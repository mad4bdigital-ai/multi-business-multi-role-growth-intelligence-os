-- Sprint 69: Dynamic Container Authority runtime contracts.
-- SQL-primary internal metadata, immutable evidence, shadow comparison, and override governance only.
-- Runtime enforcement remains disabled by default.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `container_effective_context_ledger` (
  `resolution_id` VARCHAR(36) NOT NULL,
  `request_id` VARCHAR(191) NULL,
  `idempotency_key` VARCHAR(128) NULL,
  `principal_type` ENUM('user','agent','service','group') NOT NULL,
  `principal_id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `target_container_id` VARCHAR(36) NOT NULL,
  `mode` ENUM('preview','shadow','enforce') NOT NULL DEFAULT 'preview',
  `decision` ENUM('allow','restrict','deny','ambiguous','requires_override') NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL,
  `resolver_version` VARCHAR(64) NOT NULL,
  `request_sha256` CHAR(64) NOT NULL,
  `container_path_hash` CHAR(64) NOT NULL,
  `registry_snapshot_hash` CHAR(64) NOT NULL,
  `resolution_sha256` CHAR(64) NOT NULL,
  `request_context_json` LONGTEXT NOT NULL,
  `selected_paths_json` LONGTEXT NOT NULL,
  `effective_classifications_json` LONGTEXT NOT NULL,
  `effective_roles_json` LONGTEXT NOT NULL,
  `effective_bindings_json` LONGTEXT NOT NULL,
  `applied_denies_json` LONGTEXT NOT NULL,
  `applied_delegations_json` LONGTEXT NOT NULL,
  `blocking_codes_json` LONGTEXT NOT NULL,
  `override_request_id` VARCHAR(36) NULL,
  `provider_call_made` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`resolution_id`),
  KEY `idx_cecl_resolution_hash` (`tenant_id`,`resolution_sha256`),
  KEY `idx_cecl_tenant_target_created` (`tenant_id`,`target_container_id`,`created_at`),
  KEY `idx_cecl_principal_created` (`principal_type`,`principal_id`,`created_at`),
  KEY `idx_cecl_epoch_decision` (`tenant_id`,`authority_epoch`,`decision`),
  KEY `idx_cecl_idempotency` (`tenant_id`,`principal_id`,`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_shadow_comparisons` (
  `comparison_id` VARCHAR(36) NOT NULL,
  `resolution_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `target_container_id` VARCHAR(36) NOT NULL,
  `capability_key` VARCHAR(191) NULL,
  `legacy_decision` VARCHAR(64) NOT NULL DEFAULT 'unknown',
  `container_decision` VARCHAR(64) NOT NULL,
  `comparison_status` ENUM('match','mismatch','not_comparable') NOT NULL,
  `mismatch_codes_json` LONGTEXT NOT NULL,
  `legacy_evidence_ref` VARCHAR(512) NULL,
  `latency_ms` DECIMAL(12,3) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`comparison_id`),
  KEY `idx_csc_tenant_status_created` (`tenant_id`,`comparison_status`,`created_at`),
  KEY `idx_csc_capability_status` (`capability_key`,`comparison_status`),
  KEY `idx_csc_resolution` (`resolution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_override_policy_registry` (
  `risk_class` VARCHAR(64) NOT NULL,
  `maximum_ttl_minutes` SMALLINT UNSIGNED NOT NULL,
  `required_approval_count` TINYINT UNSIGNED NOT NULL,
  `self_approval_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `one_time_consumption_required` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`risk_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_override_requests` (
  `override_id` VARCHAR(36) NOT NULL,
  `capability_envelope_id` VARCHAR(36) NULL,
  `original_resolution_id` VARCHAR(36) NOT NULL,
  `original_resolution_sha256` CHAR(64) NOT NULL,
  `original_decision` VARCHAR(64) NOT NULL,
  `original_blocking_codes_json` LONGTEXT NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL,
  `registry_snapshot_hash` CHAR(64) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `requester_principal_type` ENUM('user','agent','service','group') NOT NULL,
  `requester_principal_id` VARCHAR(191) NOT NULL,
  `target_container_id` VARCHAR(36) NOT NULL,
  `container_path_hash` CHAR(64) NOT NULL,
  `dimension_key` VARCHAR(191) NOT NULL,
  `resource_type` VARCHAR(128) NOT NULL,
  `resource_ref` VARCHAR(512) NOT NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `risk_class` VARCHAR(64) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `required_approval_count` TINYINT UNSIGNED NOT NULL,
  `approval_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('pending','ready_requires_approval','ready','rejected','expired','consumed','stale','revoked') NOT NULL DEFAULT 'pending',
  `override_sha256` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`override_id`),
  UNIQUE KEY `uq_cor_override_hash` (`override_sha256`),
  KEY `idx_cor_tenant_status_expiry` (`tenant_id`,`status`,`expires_at`),
  KEY `idx_cor_resolution` (`original_resolution_id`),
  KEY `idx_cor_envelope` (`capability_envelope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_override_approvals` (
  `approval_id` VARCHAR(36) NOT NULL,
  `override_id` VARCHAR(36) NOT NULL,
  `approver_principal_type` ENUM('user','agent','service','group') NOT NULL,
  `approver_principal_id` VARCHAR(191) NOT NULL,
  `decision` ENUM('approved','rejected') NOT NULL,
  `decision_note` VARCHAR(512) NOT NULL,
  `approval_sha256` CHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`approval_id`),
  UNIQUE KEY `uq_coa_distinct_approver` (`override_id`,`approver_principal_type`,`approver_principal_id`),
  UNIQUE KEY `uq_coa_hash` (`approval_sha256`),
  KEY `idx_coa_override_decision` (`override_id`,`decision`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_override_consumptions` (
  `consumption_id` VARCHAR(36) NOT NULL,
  `override_id` VARCHAR(36) NOT NULL,
  `execution_ref` VARCHAR(191) NOT NULL,
  `resolution_id` VARCHAR(36) NOT NULL,
  `resolution_sha256` CHAR(64) NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL,
  `action_key` VARCHAR(191) NOT NULL,
  `endpoint_key` VARCHAR(191) NOT NULL,
  `binding_ref` VARCHAR(255) NULL,
  `readback_ref` VARCHAR(512) NULL,
  `consumption_sha256` CHAR(64) NOT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `consumed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`consumption_id`),
  UNIQUE KEY `uq_coc_override_once` (`override_id`),
  UNIQUE KEY `uq_coc_execution` (`execution_ref`),
  UNIQUE KEY `uq_coc_hash` (`consumption_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_authority_idempotency` (
  `scope_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `request_sha256` CHAR(64) NOT NULL,
  `result_type` VARCHAR(64) NOT NULL,
  `result_id` VARCHAR(36) NOT NULL,
  `response_json` LONGTEXT NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope_key`,`idempotency_key`),
  KEY `idx_cai_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_projection_runs` (
  `projection_run_id` VARCHAR(36) NOT NULL,
  `mode` ENUM('dry_run','apply') NOT NULL DEFAULT 'dry_run',
  `status` ENUM('planned','running','completed','blocked','failed') NOT NULL DEFAULT 'planned',
  `source_snapshot_sha256` CHAR(64) NOT NULL,
  `projected_container_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `projected_relationship_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `held_issue_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `summary_json` LONGTEXT NOT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`projection_run_id`),
  KEY `idx_cpr_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_identity_projection_issues` (
  `issue_id` VARCHAR(36) NOT NULL,
  `projection_run_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(36) NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_ref` VARCHAR(255) NOT NULL,
  `issue_code` VARCHAR(191) NOT NULL,
  `severity` ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `issue_detail` VARCHAR(1000) NOT NULL,
  `candidate_refs_json` LONGTEXT NOT NULL,
  `status` ENUM('open','held','resolved','ignored') NOT NULL DEFAULT 'held',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` DATETIME NULL,
  PRIMARY KEY (`issue_id`),
  KEY `idx_cipi_run_status` (`projection_run_id`,`status`),
  KEY `idx_cipi_tenant_severity` (`tenant_id`,`severity`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_cache_invalidation_events` (
  `event_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL,
  `mutation_type` VARCHAR(128) NOT NULL,
  `mutation_ref` VARCHAR(255) NULL,
  `affected_container_id` VARCHAR(36) NULL,
  `event_sha256` CHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  UNIQUE KEY `uq_ccie_event_hash` (`event_sha256`),
  KEY `idx_ccie_tenant_epoch` (`tenant_id`,`authority_epoch`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_resolution_performance_samples` (
  `sample_id` VARCHAR(36) NOT NULL,
  `resolution_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `mode` ENUM('synthetic','preview','shadow') NOT NULL DEFAULT 'synthetic',
  `container_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `relationship_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `path_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `candidate_binding_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `duration_ms` DECIMAL(12,3) NOT NULL,
  `within_budget` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sample_id`),
  KEY `idx_crps_mode_created` (`mode`,`created_at`),
  KEY `idx_crps_tenant_duration` (`tenant_id`,`duration_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_rollout_policy_registry` (
  `policy_key` VARCHAR(191) NOT NULL,
  `rollout_mode` ENUM('disabled','shadow','read_only_canary','bounded_mutation','enforced') NOT NULL DEFAULT 'disabled',
  `mismatch_threshold_percent` DECIMAL(7,4) NOT NULL DEFAULT 0.5000,
  `critical_mismatch_threshold` INT UNSIGNED NOT NULL DEFAULT 0,
  `p95_budget_ms` INT UNSIGNED NOT NULL DEFAULT 150,
  `p99_budget_ms` INT UNSIGNED NOT NULL DEFAULT 400,
  `audit_coverage_required_percent` DECIMAL(7,4) NOT NULL DEFAULT 100.0000,
  `minimum_sample_count` INT UNSIGNED NOT NULL DEFAULT 100,
  `rollback_mode` ENUM('disable_consumers','return_to_shadow') NOT NULL DEFAULT 'return_to_shadow',
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_shadow_canary_registry` (
  `canary_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `container_type_key` VARCHAR(191) NULL,
  `operation_class` VARCHAR(128) NOT NULL DEFAULT 'read_only',
  `rollout_mode` ENUM('shadow','read_only_canary','disabled') NOT NULL DEFAULT 'shadow',
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`canary_key`),
  KEY `idx_cscr_capability_status` (`capability_key`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `container_override_policy_registry`
  (`risk_class`,`maximum_ttl_minutes`,`required_approval_count`,`self_approval_allowed`,`one_time_consumption_required`,`status`,`metadata_json`)
VALUES
  ('read_only',60,1,1,1,'active',JSON_OBJECT('seed','migration_320')),
  ('standard',60,1,1,1,'active',JSON_OBJECT('seed','migration_320')),
  ('high',60,1,1,1,'active',JSON_OBJECT('seed','migration_320')),
  ('critical',15,1,0,1,'active',JSON_OBJECT('seed','migration_320')),
  ('destructive',15,2,0,1,'active',JSON_OBJECT('seed','migration_320')),
  ('credential_touching',15,2,0,1,'active',JSON_OBJECT('seed','migration_320')),
  ('deployment_affecting',15,2,0,1,'active',JSON_OBJECT('seed','migration_320'))
ON DUPLICATE KEY UPDATE
  maximum_ttl_minutes=VALUES(maximum_ttl_minutes),required_approval_count=VALUES(required_approval_count),
  self_approval_allowed=VALUES(self_approval_allowed),one_time_consumption_required=VALUES(one_time_consumption_required),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `container_rollout_policy_registry`
  (`policy_key`,`rollout_mode`,`mismatch_threshold_percent`,`critical_mismatch_threshold`,`p95_budget_ms`,`p99_budget_ms`,`audit_coverage_required_percent`,`minimum_sample_count`,`rollback_mode`,`status`,`metadata_json`)
VALUES
  ('dynamic_container_authority_v1','shadow',0.5000,0,150,400,100.0000,100,'return_to_shadow','active',
   JSON_OBJECT('enforcement_enabled',false,'provider_writes_enabled',false,'seed','migration_320'))
ON DUPLICATE KEY UPDATE
  mismatch_threshold_percent=VALUES(mismatch_threshold_percent),critical_mismatch_threshold=VALUES(critical_mismatch_threshold),
  p95_budget_ms=VALUES(p95_budget_ms),p99_budget_ms=VALUES(p99_budget_ms),
  audit_coverage_required_percent=VALUES(audit_coverage_required_percent),minimum_sample_count=VALUES(minimum_sample_count),
  rollback_mode=VALUES(rollback_mode),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `container_role_template_registry`
  (`role_template_key`,`display_name`,`description`,`composition_json`,`authority_rank`,`eligible_container_types_json`,`default_scope_mode`,`status`,`metadata_json`)
VALUES
  ('container_viewer','Container Viewer','Read-only visibility within one container scope.',JSON_ARRAY(),1,JSON_ARRAY('tenant','workspace','brand','activity','workflow'),'inherit_down','active',JSON_OBJECT('implicit_override',false)),
  ('container_operator','Container Operator','Bounded operational authority; policy and resource bindings still apply.',JSON_ARRAY('container_viewer'),2,JSON_ARRAY('tenant','workspace','brand','activity','workflow'),'inherit_down','active',JSON_OBJECT('implicit_override',false)),
  ('container_admin','Container Admin','Container administration without platform-owner bypass.',JSON_ARRAY('container_operator'),3,JSON_ARRAY('tenant','workspace','brand','activity','workflow'),'inherit_down','active',JSON_OBJECT('implicit_override',false)),
  ('platform_owner','Platform Owner','Platform owner role template. Normal resolution and explicit override governance remain mandatory.',JSON_ARRAY('container_admin'),4,JSON_ARRAY('platform'),'local_only','active',JSON_OBJECT('implicit_override',false,'override_required',true))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),composition_json=VALUES(composition_json),
  authority_rank=VALUES(authority_rank),eligible_container_types_json=VALUES(eligible_container_types_json),
  default_scope_mode=VALUES(default_scope_mode),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `container_role_template_permissions`
  (`role_template_key`,`dimension_key`,`permission_key`,`effect`,`operation_patterns_json`,`conditions_json`,`merge_priority`,`status`)
VALUES
  ('container_viewer','knowledge','read','allow',JSON_ARRAY('read.*','get.*','list.*','search.*','preview.*','inspect.*','resolve.*','status.*','download.*'),NULL,10,'active'),
  ('container_viewer','assets','read','allow',JSON_ARRAY('read.*','get.*','list.*','search.*','preview.*','inspect.*','status.*','download.*'),NULL,10,'active'),
  ('container_viewer','profiles','read','allow',JSON_ARRAY('read.*','get.*','list.*','preview.*','inspect.*','resolve.*','status.*'),NULL,10,'active'),
  ('container_viewer','rules','read','allow',JSON_ARRAY('read.*','get.*','list.*','preview.*','inspect.*','resolve.*','status.*'),NULL,10,'active'),
  ('container_viewer','policies','read','allow',JSON_ARRAY('read.*','get.*','list.*','preview.*','inspect.*','resolve.*','status.*'),NULL,10,'active'),
  ('container_viewer','tools','read','allow',JSON_ARRAY('read.*','get.*','list.*','catalog.*','preview.*','inspect.*','status.*'),NULL,10,'active'),
  ('container_viewer','skills','read','allow',JSON_ARRAY('read.*','get.*','list.*','catalog.*','preview.*','inspect.*','status.*'),NULL,10,'active'),
  ('container_viewer','workflows','read','allow',JSON_ARRAY('read.*','get.*','list.*','preview.*','inspect.*','resolve.*','status.*'),NULL,10,'active'),
  ('container_viewer','actions','read','allow',JSON_ARRAY('read.*','get.*','list.*','catalog.*','preview.*','inspect.*','status.*'),NULL,10,'active'),
  ('container_viewer','endpoints','read','allow',JSON_ARRAY('read.*','get.*','list.*','catalog.*','preview.*','inspect.*','status.*'),NULL,10,'active'),
  ('container_viewer','connections','read','allow',JSON_ARRAY('read.*','get.*','list.*','metadata.*','preview.*','inspect.*','status.*'),NULL,10,'active'),
  ('container_operator','workflows','operate','allow',JSON_ARRAY('execute.*','run.*','start.*','resume.*','cancel.*'),NULL,20,'active'),
  ('container_operator','actions','operate','allow',JSON_ARRAY('execute.*','run.*','apply.*'),NULL,20,'active'),
  ('container_operator','assets','write','allow',JSON_ARRAY('create.*','update.*','write.*','publish.*'),NULL,20,'active'),
  ('container_admin','roles','manage','allow',JSON_ARRAY('create.*','update.*','revoke.*','assign.*'),NULL,30,'active'),
  ('container_admin','policies','manage','allow',JSON_ARRAY('create.*','update.*','revoke.*','apply.*'),NULL,30,'active'),
  ('container_admin','connections','manage_binding','allow',JSON_ARRAY('link.*','unlink.*','grant.*','revoke.*'),NULL,30,'active')
ON DUPLICATE KEY UPDATE
  operation_patterns_json=VALUES(operation_patterns_json),conditions_json=VALUES(conditions_json),
  merge_priority=VALUES(merge_priority),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_container_shadow_mismatch_summary` AS
SELECT
  tenant_id,
  capability_key,
  COUNT(*) AS sample_count,
  SUM(comparison_status='match') AS match_count,
  SUM(comparison_status='mismatch') AS mismatch_count,
  SUM(comparison_status='not_comparable') AS not_comparable_count,
  ROUND(100.0 * SUM(comparison_status='mismatch') / NULLIF(SUM(comparison_status IN ('match','mismatch')),0),4) AS mismatch_percent,
  ROUND(AVG(latency_ms),3) AS average_latency_ms,
  MAX(created_at) AS last_compared_at
FROM container_shadow_comparisons
GROUP BY tenant_id,capability_key;

CREATE OR REPLACE VIEW `v_container_override_readiness` AS
SELECT
  r.override_id,r.tenant_id,r.original_resolution_id,r.target_container_id,r.dimension_key,r.resource_type,r.resource_ref,
  r.operation_key,r.risk_class,r.required_approval_count,r.approval_count,r.status,r.authority_epoch,r.expires_at,
  CASE
    WHEN r.status='consumed' THEN 'override_already_consumed'
    WHEN r.expires_at<=CURRENT_TIMESTAMP THEN 'override_expired'
    WHEN r.status='stale' THEN 'override_snapshot_stale'
    WHEN r.approval_count<r.required_approval_count THEN 'override_second_approver_required'
    WHEN r.status='ready' THEN 'ready'
    ELSE r.status
  END AS readiness_code,
  0 AS secrets_included
FROM container_override_requests r;

CREATE OR REPLACE VIEW `v_container_rollout_readiness` AS
SELECT
  p.policy_key,p.rollout_mode,p.mismatch_threshold_percent,p.critical_mismatch_threshold,p.p95_budget_ms,p.p99_budget_ms,
  p.audit_coverage_required_percent,p.minimum_sample_count,
  COALESCE(SUM(s.sample_count),0) AS comparison_sample_count,
  COALESCE(SUM(s.mismatch_count),0) AS mismatch_count,
  COALESCE(MAX(s.mismatch_percent),0) AS maximum_mismatch_percent,
  COALESCE((SELECT COUNT(*) FROM v_container_relationship_issues),0) AS relationship_issue_count,
  COALESCE((SELECT COUNT(*) FROM container_identity_projection_issues WHERE status IN ('open','held') AND severity IN ('high','critical')),0) AS high_risk_projection_issue_count,
  CASE WHEN p.rollout_mode='shadow' THEN 0 ELSE 1 END AS enforcement_requested,
  CASE
    WHEN COALESCE(SUM(s.sample_count),0)<p.minimum_sample_count THEN 'insufficient_samples'
    WHEN COALESCE(MAX(s.mismatch_percent),0)>p.mismatch_threshold_percent THEN 'mismatch_threshold_exceeded'
    WHEN COALESCE((SELECT COUNT(*) FROM v_container_relationship_issues),0)>0 THEN 'relationship_issues_present'
    WHEN COALESCE((SELECT COUNT(*) FROM container_identity_projection_issues WHERE status IN ('open','held') AND severity IN ('high','critical')),0)>0 THEN 'projection_issues_present'
    ELSE 'ready_for_review'
  END AS readiness_code,
  0 AS secrets_included
FROM container_rollout_policy_registry p
LEFT JOIN v_container_shadow_mismatch_summary s ON 1=1
WHERE p.status='active'
GROUP BY p.policy_key,p.rollout_mode,p.mismatch_threshold_percent,p.critical_mismatch_threshold,p.p95_budget_ms,p.p99_budget_ms,p.audit_coverage_required_percent,p.minimum_sample_count;

INSERT INTO `platform_closure_threads`
  (`thread_key`,`state`,`required_evidence_json`,`observed_evidence_json`,`blocker_json`,`next_action`,`owner_engine_key`)
VALUES
  ('dynamic_container_shadow_resolver','validating',JSON_ARRAY('migration_320_schema','shadow_comparison_evidence','performance_samples','rollback_drill'),JSON_ARRAY('spec_001_dynamic_container_authority'),JSON_ARRAY(),'Run shadow resolver and preserve legacy dispatch authority.','resource_authority_engine'),
  ('dynamic_container_override_governance','validating',JSON_ARRAY('dual_approval_tests','stale_epoch_tests','atomic_consumption_tests'),JSON_ARRAY('migration_320_schema'),JSON_ARRAY(),'Keep override target execution disabled until enforcement promotion.','resource_authority_engine')
ON DUPLICATE KEY UPDATE
  state=VALUES(state),required_evidence_json=VALUES(required_evidence_json),observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),next_action=VALUES(next_action),owner_engine_key=VALUES(owner_engine_key),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,`requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('320_sprint69_dynamic_container_authority_runtime_contracts.sql','authorized','migration_seed','governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize additive internal resolution, shadow, override, projection, performance, idempotency, invalidation, and rollout metadata. Provider execution remains disabled.',
   JSON_OBJECT('scope','dynamic_container_authority_runtime_contracts','runtime_enforcement',false,'provider_calls',false,'credential_payload_reads',false,'external_writes',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;
