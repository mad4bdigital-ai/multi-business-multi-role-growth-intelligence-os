-- Sprint 69: Governed reconciliation policy for Growth Intelligence, sequential plans, and agent governance.
-- safety-contract: no_provider_call true
-- safety-contract: no_credential_payload_read true
-- safety-contract: no_raw_secrets true
-- safety-contract: no_external_send true
-- safety-contract: no_external_write true
-- safety-contract: secrets_included=false
-- Metadata-only and idempotent. No provider calls, credential reads, external writes, destructive SQL, or secrets.
-- This policy authorizes only the exact migration files listed below and keeps preflight plus typed confirmation mandatory.

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('243_sprint68_growth_intelligence_product_registry.sql', 'authorized', 'automation_intelligence_release_reconciliation_20260613',
   'governed_migration_runner_authorization_v1', 'high', 1, 1, 1, 1,
   'Authorize additive Growth Intelligence registry tables and lifecycle metadata through the governed migration runner.',
   JSON_OBJECT('approved_by','platform_admin','approved_at','2026-06-13','scope','exact_migration_only','no_provider_calls',TRUE,'no_external_writes',TRUE,'secrets_included',FALSE)),
  ('244_sprint68_sequential_plan_orchestrator.sql', 'authorized', 'automation_intelligence_release_reconciliation_20260613',
   'governed_migration_runner_authorization_v1', 'high', 1, 1, 1, 1,
   'Authorize sequential-plan schema reconciliation only after the enum-widening preflight is explicitly validated.',
   JSON_OBJECT('approved_by','platform_admin','approved_at','2026-06-13','scope','exact_migration_only','manual_enum_review_required',TRUE,'no_provider_calls',TRUE,'secrets_included',FALSE)),
  ('245_sprint68_agent_governance_runtime.sql', 'authorized', 'automation_intelligence_release_reconciliation_20260613',
   'governed_migration_runner_authorization_v1', 'high', 1, 1, 1, 1,
   'Authorize additive agent-governance registries, policies, view, and lifecycle metadata through the governed migration runner.',
   JSON_OBJECT('approved_by','platform_admin','approved_at','2026-06-13','scope','exact_migration_only','no_provider_calls',TRUE,'no_external_writes',TRUE,'secrets_included',FALSE)),
  ('1004_sprint69_growth_agent_migration_reconciliation_policy.sql', 'authorized', 'migration_seed',
   'governed_migration_runner_authorization_v1', 'high', 1, 1, 1, 1,
   'Authorize this metadata-only reconciliation policy migration for deterministic rebuild and ledger recording.',
   JSON_OBJECT('scope','self_authorizing_metadata_seed','metadata_only',TRUE,'secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required,
   validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_243_growth_intelligence_apply', 'governed_migration_reconciliation_v1',
   'governed_migration_reconciliation_engine', 210, 'migration_reconcile', 'sql',
   '243_sprint68_growth_intelligence_product_registry.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',TRUE,'exact_file_only',TRUE),
   'governed_migration_apply', 'high', 1, 1, 0,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback'),
   JSON_ARRAY('governed_migration_reconciliation'), 'active',
   'Apply only while required Growth Intelligence schema objects are incomplete.'),
  ('migration_reconcile_244_sequential_orchestrator_apply', 'governed_migration_reconciliation_v1',
   'governed_migration_reconciliation_engine', 210, 'migration_reconcile', 'sql',
   '244_sprint68_sequential_plan_orchestrator.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',TRUE,'enum_widening_review_required',TRUE,'exact_file_only',TRUE),
   'governed_migration_apply', 'high', 1, 1, 0,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback','execution_plan_status_enum_readback'),
   JSON_ARRAY('governed_migration_reconciliation'), 'active',
   'Apply only after the plan_status enum widening is preflight-safe and required plan schema objects are incomplete.'),
  ('migration_reconcile_245_agent_governance_apply', 'governed_migration_reconciliation_v1',
   'governed_migration_reconciliation_engine', 210, 'migration_reconcile', 'sql',
   '245_sprint68_agent_governance_runtime.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',TRUE,'exact_file_only',TRUE),
   'governed_migration_apply', 'high', 1, 1, 0,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback'),
   JSON_ARRAY('governed_migration_reconciliation'), 'active',
   'Apply only while required agent-governance schema objects or policies are incomplete.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key),
  engine_key = VALUES(engine_key),
  priority = VALUES(priority),
  task_class = VALUES(task_class),
  resource_kind = VALUES(resource_kind),
  resource_pattern = VALUES(resource_pattern),
  condition_json = VALUES(condition_json),
  strategy_key = VALUES(strategy_key),
  risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed),
  dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json),
  required_skill_keys_json = VALUES(required_skill_keys_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
