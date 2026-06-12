-- Runtime Verification Control Plane hardening.
-- Idempotent migration for DB truth state, admin tools, dashboard tile, and remediation runbooks.

CREATE TABLE IF NOT EXISTS runtime_verification_workflow_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workflow_key VARCHAR(180) NOT NULL UNIQUE,
  provider VARCHAR(80) NOT NULL DEFAULT 'github',
  workflow_file VARCHAR(255) NOT NULL,
  display_name VARCHAR(220) NOT NULL,
  allowed_refs_json JSON NULL,
  required_inputs_json JSON NULL,
  input_schema_json JSON NULL,
  default_inputs_json JSON NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_workflow_status (workflow_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_verification_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL UNIQUE,
  environment_key VARCHAR(80) NOT NULL,
  expected_commit_sha VARCHAR(64) NULL,
  deployed_commit_sha VARCHAR(64) NULL,
  workflow_key VARCHAR(180) NULL,
  runtime_base_url VARCHAR(500) NULL,
  runtime_profile VARCHAR(120) NULL,
  run_status ENUM('created','collecting','summarized','evidence_persisted','verified','degraded','blocked','expired') NOT NULL DEFAULT 'created',
  production_parity ENUM('unknown','validating','verified','degraded','blocked') NOT NULL DEFAULT 'unknown',
  summary_json JSON NULL,
  response_budget_json JSON NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_runs_env (environment_key, run_status, production_parity),
  INDEX idx_runtime_runs_commit (expected_commit_sha, deployed_commit_sha),
  INDEX idx_runtime_runs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_verification_steps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  step_id VARCHAR(36) NOT NULL UNIQUE,
  run_id VARCHAR(36) NOT NULL,
  step_key VARCHAR(180) NOT NULL,
  step_status ENUM('pending','running','pass','warn','fail','blocked','skipped','cancelled') NOT NULL DEFAULT 'pending',
  classification VARCHAR(120) NULL,
  duration_ms INT UNSIGNED NULL,
  http_status INT NULL,
  response_bytes INT UNSIGNED NULL,
  max_allowed_bytes INT UNSIGNED NULL,
  detail_json JSON NULL,
  error_json JSON NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_steps_run (run_id, step_status),
  INDEX idx_runtime_steps_key (step_key, step_status),
  CONSTRAINT fk_runtime_steps_run FOREIGN KEY (run_id) REFERENCES runtime_verification_runs(run_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_verification_evidence_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chunk_id VARCHAR(36) NOT NULL UNIQUE,
  run_id VARCHAR(36) NOT NULL,
  surface_key VARCHAR(180) NOT NULL,
  chunk_index INT UNSIGNED NOT NULL DEFAULT 0,
  chunk_type ENUM('summary','manifest','items','graph','log','artifact_ref') NOT NULL DEFAULT 'items',
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  byte_size INT UNSIGNED NOT NULL DEFAULT 0,
  sha256 VARCHAR(64) NULL,
  storage_mode ENUM('inline_json','external_ref') NOT NULL DEFAULT 'inline_json',
  payload_json JSON NULL,
  payload_ref VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_runtime_evidence_run_surface (run_id, surface_key, chunk_index),
  CONSTRAINT fk_runtime_evidence_run FOREIGN KEY (run_id) REFERENCES runtime_verification_runs(run_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_verification_gaps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gap_id VARCHAR(36) NOT NULL UNIQUE,
  run_id VARCHAR(36) NOT NULL,
  gap_key VARCHAR(180) NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  classification VARCHAR(120) NOT NULL,
  blocks_production_parity TINYINT(1) NOT NULL DEFAULT 1,
  remediation TEXT NULL,
  evidence_ref VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_runtime_gaps_run (run_id, blocks_production_parity, severity),
  CONSTRAINT fk_runtime_gaps_run FOREIGN KEY (run_id) REFERENCES runtime_verification_runs(run_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_deployment_parity_status (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  environment_key VARCHAR(80) NOT NULL UNIQUE,
  expected_commit_sha VARCHAR(64) NULL,
  deployed_commit_sha VARCHAR(64) NULL,
  production_parity ENUM('unknown','validating','verified','degraded','blocked') NOT NULL DEFAULT 'unknown',
  latest_run_id VARCHAR(36) NULL,
  ci_gate_status ENUM('unknown','pass','warn','fail','blocked') NOT NULL DEFAULT 'unknown',
  release_readiness_status ENUM('unknown','pass','warn','fail','blocked') NOT NULL DEFAULT 'unknown',
  runtime_health_status ENUM('unknown','pass','warn','fail','blocked') NOT NULL DEFAULT 'unknown',
  activation_summary_status ENUM('unknown','pass','warn','fail','blocked') NOT NULL DEFAULT 'unknown',
  migration_status ENUM('unknown','pass','warn','fail','blocked') NOT NULL DEFAULT 'unknown',
  blocking_gap_count INT UNSIGNED NOT NULL DEFAULT 0,
  verified_at DATETIME NULL,
  status_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_parity_state (production_parity, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_ci_check_classification_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  raw_status VARCHAR(80) NOT NULL,
  raw_conclusion VARCHAR(80) NULL,
  superseded_by_success TINYINT(1) NOT NULL DEFAULT 0,
  classification VARCHAR(120) NOT NULL,
  gate_status ENUM('pass','warn','fail','blocked','ignore') NOT NULL DEFAULT 'blocked',
  blocks_production_parity TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_runtime_ci_classification (raw_status, raw_conclusion, superseded_by_success),
  INDEX idx_runtime_ci_gate (gate_status, blocks_production_parity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_gap_remediation_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gap_key VARCHAR(180) NOT NULL UNIQUE,
  classification VARCHAR(120) NOT NULL,
  owner_key VARCHAR(120) NOT NULL DEFAULT 'runtime_platform',
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  remediation_type ENUM('retry','classification_update','repo_patch_or_deploy','contract_split','db_migration','credential_repair','manual_review') NOT NULL DEFAULT 'manual_review',
  auto_fix_allowed TINYINT(1) NOT NULL DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  recommended_action TEXT NULL,
  runbook_json JSON NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_gap_remediation_status (status, severity, auto_fix_allowed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_runtime_verification_latest AS
SELECT r.*
FROM runtime_verification_runs r
JOIN (
  SELECT environment_key, MAX(created_at) AS latest_created_at
  FROM runtime_verification_runs
  GROUP BY environment_key
) latest ON latest.environment_key = r.environment_key AND latest.latest_created_at = r.created_at;

CREATE OR REPLACE VIEW v_runtime_production_parity AS
SELECT
  s.environment_key,
  s.expected_commit_sha,
  s.deployed_commit_sha,
  s.production_parity,
  s.latest_run_id,
  s.ci_gate_status,
  s.release_readiness_status,
  s.runtime_health_status,
  s.activation_summary_status,
  s.migration_status,
  s.blocking_gap_count,
  s.verified_at,
  s.updated_at,
  CASE
    WHEN s.production_parity = 'verified' AND s.blocking_gap_count = 0 THEN 'ready'
    WHEN s.production_parity IN ('blocked','degraded') THEN 'blocked'
    WHEN s.production_parity = 'validating' THEN 'validating'
    ELSE 'unknown'
  END AS readiness_classification
FROM runtime_deployment_parity_status s;

CREATE OR REPLACE VIEW v_runtime_verification_evidence_manifest AS
SELECT
  r.run_id,
  r.environment_key,
  r.production_parity,
  e.surface_key,
  COUNT(*) AS chunk_count,
  COALESCE(SUM(e.item_count),0) AS total_items,
  COALESCE(SUM(e.byte_size),0) AS total_bytes,
  MIN(e.created_at) AS first_chunk_at,
  MAX(e.created_at) AS latest_chunk_at
FROM runtime_verification_runs r
LEFT JOIN runtime_verification_evidence_chunks e ON e.run_id = r.run_id
GROUP BY r.run_id, r.environment_key, r.production_parity, e.surface_key;

CREATE OR REPLACE VIEW v_runtime_ci_check_gate AS
SELECT raw_status, raw_conclusion, superseded_by_success, classification, gate_status, blocks_production_parity, status
FROM runtime_ci_check_classification_registry
WHERE status = 'active';

INSERT INTO runtime_verification_workflow_registry
(workflow_key, provider, workflow_file, display_name, allowed_refs_json, required_inputs_json, input_schema_json, default_inputs_json, status)
VALUES
('verify_runtime','github','verify-runtime.yml','Verify Runtime',JSON_ARRAY('main'),JSON_ARRAY('runtime_base_url','environment_label','runtime_profile'),JSON_OBJECT('runtime_base_url','url','environment_label','string','runtime_profile','string','allow_environment_access_blocked','boolean'),JSON_OBJECT('runtime_base_url','https://auth.mad4b.com','environment_label','production','runtime_profile','api_only','allow_environment_access_blocked','true'),'active')
ON DUPLICATE KEY UPDATE workflow_file=VALUES(workflow_file), display_name=VALUES(display_name), allowed_refs_json=VALUES(allowed_refs_json), required_inputs_json=VALUES(required_inputs_json), input_schema_json=VALUES(input_schema_json), default_inputs_json=VALUES(default_inputs_json), status=VALUES(status);

INSERT INTO runtime_ci_check_classification_registry
(raw_status, raw_conclusion, superseded_by_success, classification, gate_status, blocks_production_parity, description, status)
VALUES
('completed','success',0,'success','pass',0,'Completed successful check.','active'),
('completed','failure',0,'failure','blocked',1,'Completed failed check blocks production parity.','active'),
('completed','timed_out',0,'timed_out','blocked',1,'Timed out check blocks production parity.','active'),
('completed','cancelled',0,'cancelled_unknown','blocked',1,'Cancelled check without superseding success blocks production parity.','active'),
('completed','cancelled',1,'cancelled_superseded_success','pass',0,'Cancelled check is acceptable only when superseded by successful equivalent run.','active'),
('completed','skipped',0,'skipped_unclassified','warn',0,'Skipped checks require required/optional policy context.','active'),
('in_progress',NULL,0,'in_progress','warn',1,'In-progress check keeps parity validating.','active'),
('queued',NULL,0,'queued','warn',1,'Queued check keeps parity validating.','active')
ON DUPLICATE KEY UPDATE classification=VALUES(classification), gate_status=VALUES(gate_status), blocks_production_parity=VALUES(blocks_production_parity), description=VALUES(description), status=VALUES(status);

INSERT INTO runtime_gap_remediation_registry
(gap_key, classification, owner_key, severity, remediation_type, auto_fix_allowed, approval_required, recommended_action, runbook_json, status)
VALUES
('runtime_code_routes_not_installed','route_missing','runtime_platform','high','repo_patch_or_deploy',0,1,'Install runtime verification service/routes through protected-branch-compliant branch + CI + merge, then run runtime verification API readback.',JSON_OBJECT('diagnosis','Runtime verification DB layer exists but API routes are missing.','steps',JSON_ARRAY('create governed branch','add runtimeVerificationService and runtimeVerificationRoutes','mount routes','run CI','merge to main','run runtime_verification_run_create_api'),'success_condition','production_parity=verified and blocking_gap_count=0'),'active'),
('activation_summary_too_large','response_budget_exceeded','activation_runtime','high','contract_split',1,0,'Return summary and evidence manifest by default; move detailed evidence to paginated chunks.',JSON_OBJECT('diagnosis','Activation response exceeded client/tool response budget.','steps',JSON_ARRAY('switch default detail_level to summary','persist evidence chunks','return evidence manifest URLs'),'success_condition','summary response below max_response_bytes'),'active'),
('activation_summary_degraded','activation_registry_tables_missing','activation_runtime','high','db_migration',0,1,'Apply missing activation registry migrations and rerun runtime verification.',JSON_OBJECT('diagnosis','Activation registry summary reported degraded surfaces.','steps',JSON_ARRAY('read runtime verification evidence','identify missing tables','apply governed migrations','rerun verification'),'success_condition','activation_summary=pass'),'active'),
('deployed_commit_mismatch','deployment_parity_mismatch','release_platform','critical','repo_patch_or_deploy',0,1,'Redeploy production or reconcile expected commit with runtime deployed commit, then rerun verification.',JSON_OBJECT('diagnosis','Runtime deployed commit differs from expected main commit.','steps',JSON_ARRAY('read /deployment-info','compare expected and deployed commit','redeploy or reconcile','rerun verification'),'success_condition','expected_commit_sha equals deployed_commit_sha'),'active'),
('ci_cancelled_unknown','cancelled_unknown','release_platform','high','classification_update',1,0,'Check for newer equivalent successful check-run; if found classify cancelled as superseded_success, otherwise block parity.',JSON_OBJECT('diagnosis','Required CI check was cancelled without confirmed superseding success.','steps',JSON_ARRAY('read check-runs for commit','find newer equivalent success','update classification or rerun CI'),'success_condition','ci_gate_status=pass'),'active')
ON DUPLICATE KEY UPDATE classification=VALUES(classification), owner_key=VALUES(owner_key), severity=VALUES(severity), remediation_type=VALUES(remediation_type), auto_fix_allowed=VALUES(auto_fix_allowed), approval_required=VALUES(approval_required), recommended_action=VALUES(recommended_action), runbook_json=VALUES(runbook_json), status=VALUES(status);

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category, default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('runtime_production_parity','platform','runtime_verification','platform','Runtime Production Parity','Shows production parity, latest runtime verification run, blocking gaps, commit alignment, and evidence manifest availability.','runtime_verification','admin_only','platform_native','runtime_parity_status_api',300,5,'critical','active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category), status_callback_key=VALUES(status_callback_key), freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key, endpoint_selector, safe_mode, allowed_sources_json, output_contract_json, fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('runtime_parity_status_read','runtime_production_parity','platform','runtime_verification','runtime.parity.status.read','runtime_parity_status_api','GET /runtime/parity/{environmentKey}','read_only',JSON_ARRAY('platform_native','runtime_verification_control_plane'),JSON_OBJECT('returns',JSON_ARRAY('production_parity','latest_run_id','blocking_gap_count','readiness_classification'),'secrets_included',false),NULL,300,5,'active'),
('runtime_verification_run_create','runtime_production_parity','platform','runtime_verification','runtime.verification.run.create','runtime_verification_run_create_api','POST /runtime/verification-runs','advisory',JSON_ARRAY('platform_native','runtime_verification_control_plane'),JSON_OBJECT('returns',JSON_ARRAY('run_id','production_parity','steps','gaps','summary'),'secrets_included',false),NULL,300,10,'active'),
('runtime_verification_evidence_read','runtime_production_parity','platform','runtime_verification','runtime.verification.evidence.read','runtime_verification_evidence_read_api','GET /runtime/verification-runs/{runId}/evidence','read_only',JSON_ARRAY('platform_native','runtime_verification_control_plane'),JSON_OBJECT('returns',JSON_ARRAY('items','page'),'paginated',true,'secrets_included',false),NULL,300,15,'active')
ON DUPLICATE KEY UPDATE runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector), safe_mode=VALUES(safe_mode), allowed_sources_json=VALUES(allowed_sources_json), output_contract_json=VALUES(output_contract_json), freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('runtime_verification_run_create_api','Create Runtime Verification Run','Create a runtime verification run through the runtime verification control plane API. Writes parity ledger and evidence chunks. No secrets.','POST','/runtime/verification-runs',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('environment_key',JSON_OBJECT('type','string','default','production'),'expected_commit_sha',JSON_OBJECT('type','string'),'deployed_commit_sha',JSON_OBJECT('type','string'),'runtime_base_url',JSON_OBJECT('type','string','default','https://auth.mad4b.com'),'runtime_profile',JSON_OBJECT('type','string','default','api_only'),'response_budget',JSON_OBJECT('type','object'))),'{}','admin,runtime-verification,state_changing,no_secrets,api_control_plane',1,11990),
('runtime_parity_status_api','Read Runtime Parity API','Read current runtime parity state through the runtime verification control plane API. No secrets.','GET','/runtime/parity/{environmentKey}',JSON_ARRAY('environmentKey'),JSON_OBJECT('type','object','properties',JSON_OBJECT('environmentKey',JSON_OBJECT('type','string','default','production'))),NULL,'admin,runtime-verification,read_only,no_secrets,api_control_plane',1,11991),
('runtime_verification_run_read_api','Read Runtime Verification Run API','Read one runtime verification run through the runtime verification control plane API. No secrets.','GET','/runtime/verification-runs/{runId}',JSON_ARRAY('runId'),JSON_OBJECT('type','object','required',JSON_ARRAY('runId'),'properties',JSON_OBJECT('runId',JSON_OBJECT('type','string'))),NULL,'admin,runtime-verification,read_only,no_secrets,api_control_plane',1,11992),
('runtime_verification_evidence_read_api','Read Runtime Verification Evidence API','Read paginated runtime verification evidence through the runtime verification control plane API. No secrets.','GET','/runtime/verification-runs/{runId}/evidence',JSON_ARRAY('runId'),JSON_OBJECT('type','object','required',JSON_ARRAY('runId'),'properties',JSON_OBJECT('runId',JSON_OBJECT('type','string'),'surface',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'cursor',JSON_OBJECT('type','string'))),NULL,'admin,runtime-verification,read_only,no_secrets,api_control_plane',1,11993),
('tenant_repo_pr_reconciliation_sweep','Tenant Repo PR Reconciliation Sweep','Admin-dispatched system-layer read-only repository pull request reconciliation sweep. No secrets.','POST','/admin/system/tools/call',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('arguments',JSON_OBJECT('type','object'))),JSON_OBJECT('name','tenant_repo_pr_reconciliation_sweep'),'admin,system-layer,repository-intelligence,read_only,no_secrets',1,11800),
('tenant_repository_intelligence_v2_readiness_smoke','Tenant Repository Intelligence V2 Readiness Smoke','Admin-dispatched system-layer smoke for Repository Intelligence V2 readiness. No secrets.','POST','/admin/system/tools/call',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('arguments',JSON_OBJECT('type','object'))),JSON_OBJECT('name','tenant_repository_intelligence_v2_readiness_smoke'),'admin,system-layer,repository-intelligence,smoke,no_secrets',1,11810),
('tenant_repository_intelligence_report','Tenant Repository Intelligence Report','Repository Intelligence V3 read-only report entrypoint routed through governed system-layer registry. No secrets.','POST','/admin/system/tools/call',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('arguments',JSON_OBJECT('type','object'))),JSON_OBJECT('name','tenant_repository_intelligence_report'),'admin,system-layer,repository-intelligence,read_only,no_secrets,planned_compatible',1,11820),
('tenant_repository_action_planner_dry_run','Tenant Repository Action Planner Dry Run','Repository Intelligence V4 non-executing action planner dry-run entrypoint routed through governed system-layer registry. No secrets.','POST','/admin/system/tools/call',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('arguments',JSON_OBJECT('type','object'))),JSON_OBJECT('name','tenant_repository_action_planner_dry_run'),'admin,system-layer,repository-intelligence,dry_run,no_secrets,planned_compatible',1,11830),
('tenant_repository_intelligence_v3_v4_readiness_smoke','Tenant Repository Intelligence V3/V4 Readiness Smoke','Repository Intelligence V3/V4 readiness smoke entrypoint routed through governed system-layer registry. No secrets.','POST','/admin/system/tools/call',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('arguments',JSON_OBJECT('type','object'))),JSON_OBJECT('name','tenant_repository_intelligence_v3_v4_readiness_smoke'),'admin,system-layer,repository-intelligence,smoke,no_secrets,planned_compatible',1,11840)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

UPDATE admin_platform_endpoint_tools
SET tags = CONCAT(COALESCE(tags,''), ',fallback,break_glass,not_primary')
WHERE tool_key IN ('runtime_verification_db_only_run_create','runtime_parity_status_read','runtime_verification_latest_read','runtime_verification_gaps_read','runtime_verification_evidence_manifest_read')
  AND tags NOT LIKE '%not_primary%';
