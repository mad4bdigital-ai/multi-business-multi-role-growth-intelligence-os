-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Adds internal-only read-only canary observations and a governed rollback path. Global enforcement remains disabled.

CREATE TABLE IF NOT EXISTS `container_canary_observations` (
  `observation_id` VARCHAR(36) NOT NULL,
  `canary_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `request_id` VARCHAR(191) NOT NULL,
  `rollout_mode` ENUM('read_only_canary') NOT NULL DEFAULT 'read_only_canary',
  `outcome` ENUM('success','error') NOT NULL,
  `http_status` SMALLINT UNSIGNED NOT NULL,
  `readiness_code` VARCHAR(191) NULL,
  `duration_ms` DECIMAL(12,3) NOT NULL,
  `response_sha256` CHAR(64) NULL,
  `error_code` VARCHAR(191) NULL,
  `provider_call_made` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `external_write_made` TINYINT(1) NOT NULL DEFAULT 0,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`observation_id`),
  KEY `idx_cco_canary_created` (`canary_key`,`created_at`),
  KEY `idx_cco_capability_outcome` (`capability_key`,`outcome`,`created_at`),
  KEY `idx_cco_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_container_canary_monitoring_summary` AS
SELECT
  c.canary_key,
  c.capability_key,
  c.rollout_mode,
  c.status,
  c.updated_at AS mode_started_at,
  p.minimum_sample_count AS required_observation_count,
  COALESCE(m.observation_count,0) AS observation_count,
  COALESCE(m.success_count,0) AS success_count,
  COALESCE(m.failure_count,0) AS failure_count,
  COALESCE(m.average_latency_ms,0) AS average_latency_ms,
  COALESCE(m.p95_latency_ms,0) AS p95_latency_ms,
  COALESCE(m.audit_coverage_percent,0) AS audit_coverage_percent,
  m.last_readiness_code,
  m.last_observed_at,
  CASE
    WHEN c.rollout_mode <> 'read_only_canary' THEN 'not_in_canary'
    WHEN COALESCE(m.observation_count,0) < p.minimum_sample_count THEN 'insufficient_observations'
    WHEN COALESCE(m.failure_count,0) > 0 THEN 'failures_present'
    WHEN COALESCE(m.audit_coverage_percent,0) < p.audit_coverage_required_percent THEN 'audit_coverage_below_required'
    WHEN COALESCE(m.p95_latency_ms,0) > p.p95_budget_ms THEN 'p95_latency_budget_exceeded'
    ELSE 'ready_for_review'
  END AS monitoring_code,
  0 AS enforcement_requested,
  0 AS secrets_included
FROM container_shadow_canary_registry c
JOIN container_rollout_policy_registry p
  ON p.policy_key='dynamic_container_authority_v1' AND p.status='active'
LEFT JOIN (
  SELECT
    ranked.canary_key,
    COUNT(*) AS observation_count,
    SUM(ranked.outcome='success') AS success_count,
    SUM(ranked.outcome='error') AS failure_count,
    ROUND(AVG(ranked.duration_ms),3) AS average_latency_ms,
    ROUND(MAX(CASE WHEN ranked.percentile_rank <= 0.95 THEN ranked.duration_ms END),3) AS p95_latency_ms,
    ROUND(100.0 * SUM(
      ranked.provider_call_made=0
      AND ranked.credential_payload_read=0
      AND ranked.external_write_made=0
      AND ranked.secrets_included=0
    ) / NULLIF(COUNT(*),0),4) AS audit_coverage_percent,
    SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(ranked.readiness_code,'') ORDER BY ranked.created_at DESC SEPARATOR ','),',',1) AS last_readiness_code,
    MAX(ranked.created_at) AS last_observed_at
  FROM (
    SELECT
      o.*,
      PERCENT_RANK() OVER (PARTITION BY o.canary_key ORDER BY o.duration_ms) AS percentile_rank
    FROM container_canary_observations o
    JOIN container_shadow_canary_registry current_canary
      ON current_canary.canary_key=o.canary_key
     AND o.created_at >= current_canary.updated_at
  ) ranked
  GROUP BY ranked.canary_key
) m ON m.canary_key=c.canary_key
WHERE c.status='active';

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`, `app_key`, `capability_key`, `operation_intent`, `runtime_surface`, `status`,
   `allow_external_write`, `allow_credential_binding`, `allow_no_credential_binding`,
   `requires_ready_for_dispatch`, `requires_dispatch_allowed`, `requires_zero_blocking_gaps`,
   `requires_audit_evidence`, `requires_readback`, `requires_typed_confirmation`,
   `requires_same_cycle_dry_run`, `allowed_source_tiers_json`, `policy_json`, `notes`)
VALUES
  ('dynamic_container_canary_rollback_policy_v1', 'platform_orchestration',
   'dynamic_container_canary_rollback', 'dynamic_container_canary_rollback', 'auth_host', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT(
     'internal_sql_mutation_only', TRUE,
     'rollback_to_shadow_only', TRUE,
     'single_canary_only', TRUE,
     'provider_call_forbidden', TRUE,
     'external_write_forbidden', TRUE,
     'credential_payload_read_forbidden', TRUE,
     'global_rollout_policy_change_forbidden', TRUE,
     'mutation_enforcement_forbidden', TRUE,
     'same_cycle_dry_run_required', TRUE,
     'same_cycle_readback_required', TRUE,
     'transactional_envelope_consumption_required', TRUE,
     'secrets_included', FALSE
   ),
   'Admin-only policy for returning exactly one Dynamic Container read-only canary to shadow.')
ON DUPLICATE KEY UPDATE
  `app_key`=VALUES(`app_key`),
  `capability_key`=VALUES(`capability_key`),
  `operation_intent`=VALUES(`operation_intent`),
  `runtime_surface`=VALUES(`runtime_surface`),
  `status`=VALUES(`status`),
  `allow_external_write`=VALUES(`allow_external_write`),
  `allow_credential_binding`=VALUES(`allow_credential_binding`),
  `allow_no_credential_binding`=VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch`=VALUES(`requires_ready_for_dispatch`),
  `requires_dispatch_allowed`=VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps`=VALUES(`requires_zero_blocking_gaps`),
  `requires_audit_evidence`=VALUES(`requires_audit_evidence`),
  `requires_readback`=VALUES(`requires_readback`),
  `requires_typed_confirmation`=VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run`=VALUES(`requires_same_cycle_dry_run`),
  `allowed_source_tiers_json`=VALUES(`allowed_source_tiers_json`),
  `policy_json`=VALUES(`policy_json`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
  (
    'dynamic_container_canary_rollback',
    'Dynamic Container Canary Rollback',
    'Dry-run or return exactly one active read-only Dynamic Container canary to shadow. Apply requires typed confirmation and an apply-authorized capability envelope consumed transactionally with same-cycle readback. Global rollout mode and enforcement remain unchanged.',
    'POST',
    '/admin/container-authority/canary-rollbacks',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('mode','targetCanaryKey'),
      'properties',JSON_OBJECT(
        'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
        'targetCanaryKey',JSON_OBJECT('type','string','minLength',1,'maxLength',191),
        'reason',JSON_OBJECT('type','string','minLength',3,'maxLength',512),
        'confirm',JSON_OBJECT('type','string','maxLength',255),
        'capabilityEnvelopeId',JSON_OBJECT('type','string','format','uuid')
      ),
      'additionalProperties',FALSE
    ),
    NULL,
    'admin,dynamic_container,canary,rollback,state_changing,dry_run_default,typed_confirmation,capability_envelope,same_cycle_readback,internal_sql_only,rollback_to_shadow,no_global_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
    1,
    418
  ),
  (
    'dynamic_container_canary_monitoring',
    'Dynamic Container Canary Monitoring',
    'Read current-cycle observations for active Dynamic Container canaries, including counts, failures, latency, audit coverage, and monitoring readiness. Read-only; no provider call, credential read, external write, or enforcement.',
    'GET',
    '/container-authority/canary-monitoring',
    JSON_ARRAY(),
    JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',FALSE),
    NULL,
    'admin,dynamic_container,canary,monitoring,read_only,current_cycle,audit,latency,no_provider_call,no_credentials,no_external_write,no_secrets',
    1,
    419
  )
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES
  (
    'bind_tool_dynamic_container_canary_rollback',
    'platform_orchestration',
    'dynamic_container_canary_rollback',
    'admin_platform_tool',
    'state_changing',
    'none',
    'admin',
    'active',
    'Internal single-canary rollback to shadow only. Apply is envelope-bound and cannot change global rollout policy or enable enforcement.'
  ),
  (
    'bind_tool_dynamic_container_canary_monitoring',
    'platform_orchestration',
    'dynamic_container_canary_monitoring',
    'admin_platform_tool',
    'read_only',
    'none',
    'admin',
    'active',
    'Read current-cycle Dynamic Container canary observation evidence only.'
  )
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),
  tool_key=VALUES(tool_key),
  tool_surface=VALUES(tool_surface),
  binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope),
  status=VALUES(status),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '20260715_dynamic_container_canary_runtime_observability.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize additive Dynamic Container canary observation, monitoring, and rollback governance without enabling enforcement.',
  JSON_OBJECT(
    'scope','dynamic_container_canary_runtime_observability',
    'observation_ledger',true,
    'rollback_to_shadow_only',true,
    'global_rollout_policy_change',false,
    'mutation_enforcement',false,
    'historical_evidence_preserved',true,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'secrets_included',false
  )
)
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),
  authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),
  requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply),
  notes=VALUES(notes),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
