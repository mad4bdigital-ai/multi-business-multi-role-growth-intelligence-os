-- Self-Healing Release Advisor.
-- Advisory-only internal planning. No provider dispatch, external write, gate mutation, job enqueue, or execution authority.

CREATE TABLE IF NOT EXISTS release_advisor_runs (
  advisor_run_id CHAR(36) NOT NULL,
  plan_fingerprint_sha256 CHAR(64) NOT NULL,
  policy_version VARCHAR(96) NOT NULL,
  environment_key VARCHAR(64) NOT NULL DEFAULT 'production',
  runtime_verification_run_id CHAR(36) NOT NULL,
  release_operation_id CHAR(36) NULL,
  target_id CHAR(36) NULL,
  expected_commit_sha VARCHAR(64) NULL,
  deployed_commit_sha VARCHAR(64) NULL,
  advisor_status ENUM('generated','review_required','blocked','no_action','superseded') NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
  recommendation_count INT UNSIGNED NOT NULL DEFAULT 0,
  blocking_gap_count INT UNSIGNED NOT NULL DEFAULT 0,
  requires_approval TINYINT(1) NOT NULL DEFAULT 0,
  summary_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by VARCHAR(191) NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (advisor_run_id),
  UNIQUE KEY uq_release_advisor_plan_fingerprint (plan_fingerprint_sha256),
  KEY idx_release_advisor_environment_status (environment_key, advisor_status, created_at),
  KEY idx_release_advisor_verification (runtime_verification_run_id),
  KEY idx_release_advisor_operation (release_operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_advisor_recommendations (
  recommendation_id CHAR(36) NOT NULL,
  advisor_run_id CHAR(36) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  recommendation_fingerprint_sha256 CHAR(64) NOT NULL,
  recommendation_key VARCHAR(191) NOT NULL,
  gap_key VARCHAR(180) NULL,
  classification VARCHAR(120) NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  remediation_type VARCHAR(64) NOT NULL DEFAULT 'manual_review',
  action_key VARCHAR(191) NOT NULL,
  template_key VARCHAR(191) NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  auto_fix_allowed TINYINT(1) NOT NULL DEFAULT 0,
  execution_allowed TINYINT(1) NOT NULL DEFAULT 0,
  provider_write TINYINT(1) NOT NULL DEFAULT 0,
  external_write TINYINT(1) NOT NULL DEFAULT 0,
  recommendation_json JSON NOT NULL,
  runbook_json JSON NOT NULL,
  evidence_ref VARCHAR(512) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (recommendation_id),
  UNIQUE KEY uq_release_advisor_run_sequence (advisor_run_id, sequence_no),
  UNIQUE KEY uq_release_advisor_recommendation_fingerprint (advisor_run_id, recommendation_fingerprint_sha256),
  KEY idx_release_advisor_recommendation_gap (gap_key, severity),
  KEY idx_release_advisor_recommendation_action (action_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('release_advisor_run_create','Create Self-Healing Release Advisor Run','Create or deduplicate an advisory-only release remediation plan from runtime verification evidence.','POST','/admin/release-advisor-runs',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('environment_key',JSON_OBJECT('type','string','maxLength',64),'runtime_verification_run_id',JSON_OBJECT('type','string','format','uuid'),'release_operation_id',JSON_OBJECT('type','string','format','uuid'),'target_id',JSON_OBJECT('type','string','format','uuid'),'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'context',JSON_OBJECT('type','object')),'additionalProperties',false),NULL,'release_intelligence,advisor,advisory_only,internal_write,idempotent,no_execution,no_provider_call,no_external_write,no_secrets',1,6770),
  ('release_advisor_run_get','Get Self-Healing Release Advisor Run','Read one advisor run with bounded recommendations and no-secret evidence.','GET','/admin/release-advisor-runs/{advisorRunId}',JSON_ARRAY('advisorRunId'),JSON_OBJECT('type','object','required',JSON_ARRAY('advisorRunId'),'properties',JSON_OBJECT('advisorRunId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false),NULL,'release_intelligence,advisor,read_only,no_execution,no_provider_call,no_external_write,no_secrets',1,6771)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('Release Intelligence Governance','self_healing_release_advisor_policy_v1',
   JSON_OBJECT('rule','advisor_may_plan_but_never_execute','enforcement_mode','blocking','runtime_verification_evidence_required',true,'remediation_registry_authority_required',true,'release_operation_creation_forbidden',true,'gate_mutation_forbidden',true,'capability_envelope_creation_forbidden',true,'job_enqueue_forbidden',true,'provider_calls_forbidden',true,'external_writes_forbidden',true,'execution_allowed',false,'same_cycle_readback_required_for_future_execution',true,'secrets_included',false),
   'TRUE','release_advisor_run_create|release_advisor_run_get|gpt_tools_call|tool_dispatch',
   'selfHealingReleaseAdvisorService|selfHealingReleaseAdvisorRoutes|release_advisor_runs|release_advisor_recommendations',
   'TRUE','The advisor may generate immutable remediation plans only. Execution requires a later independent governed workflow, fresh capability envelope, approval, and readback.')
ON DUPLICATE KEY UPDATE policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
