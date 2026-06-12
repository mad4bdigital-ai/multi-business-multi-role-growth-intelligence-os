-- Sprint 69: Dynamic governed migration reconciliation.
-- Purpose: classify repository migrations against live authorization, ledger, preflight,
-- and schema evidence, then permit automatic execution only through explicit DB rules.
-- Safety: additive/idempotent, deny-by-default, no secrets, no provider calls.
-- Runtime evidence is written to platform_engine_execution_runs and platform_audit_event_bus.

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json,
   capabilities_json, default_policy_key, status, notes)
VALUES
  ('governed_migration_reconciliation_engine','Governed Migration Reconciliation Engine',
   'schema_governance',NULL,JSON_ARRAY('migration_reconcile'),
   JSON_OBJECT('dynamic_discovery',true,'db_policy_authority',true,'delegates_to_governed_migration_runner',true,'writes_dynamic_audit_event',true,'executes_db_stored_code',false),
   'governed_migration_reconciliation_v1','active',
   'Dynamically classifies migration drift and delegates explicitly allowed record-only/apply actions to the governed runner.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), engine_type = VALUES(engine_type),
  supported_task_classes_json = VALUES(supported_task_classes_json), capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key), status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, mode, risk_default, approval_required_min_risk,
   require_scope_guard, require_audit, require_validators, validators_json,
   allowed_resource_patterns_json, blocked_resource_patterns_json, status, notes)
VALUES
  ('governed_migration_reconciliation_v1','governed_migration_reconciliation_engine','global','apply_allowed',
   'high','high',1,1,1,JSON_ARRAY('migration_preflight_pass','schema_evidence_readback'),
   JSON_ARRAY('*.sql'),JSON_ARRAY('*secret*','*.env'),'active',
   'Automatic mutation remains deny-by-default and requires an exact active policy rule plus governed runner authorization.')
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key), mode = VALUES(mode), risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk), require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit), require_validators = VALUES(require_validators),
  validators_json = VALUES(validators_json), allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json), status = VALUES(status), notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_strategy_registry
  (strategy_key, display_name, description, supported_engine_types_json, supported_task_classes_json,
   supported_resource_kinds_json, requires_ast, allows_full_resource_rewrite, executes_dynamic_code,
   required_validators_json, risk_level, status, metadata_json)
VALUES
  ('governed_migration_record_only','Governed Migration Record-only Reconciliation',
   'Record matching-checksum ledger evidence only when all required schema objects already exist.',
   JSON_ARRAY('schema_governance'),JSON_ARRAY('migration_reconcile'),JSON_ARRAY('sql'),0,0,0,
   JSON_ARRAY('migration_preflight_pass','complete_schema_evidence'),'high','active',
   JSON_OBJECT('implementation','governed-migration-runner.mjs','applies_sql',false,'secrets_included',false)),
  ('governed_migration_apply','Governed Migration Apply Reconciliation',
   'Apply an explicitly authorized migration only when required schema objects remain incomplete.',
   JSON_ARRAY('schema_governance'),JSON_ARRAY('migration_reconcile'),JSON_ARRAY('sql'),0,0,0,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback'),'high','active',
   JSON_OBJECT('implementation','governed-migration-runner.mjs','secrets_included',false))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description),
  supported_engine_types_json = VALUES(supported_engine_types_json), supported_task_classes_json = VALUES(supported_task_classes_json),
  supported_resource_kinds_json = VALUES(supported_resource_kinds_json), executes_dynamic_code = VALUES(executes_dynamic_code),
  required_validators_json = VALUES(required_validators_json), risk_level = VALUES(risk_level), status = VALUES(status),
  metadata_json = VALUES(metadata_json), updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
   approval_required, validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_305_record_only','governed_migration_reconciliation_v1','governed_migration_reconciliation_engine',
   200,'migration_reconcile','sql','305_sprint69_runtime_verification_control_plane_hardening.sql',
   JSON_OBJECT('required_schema_state','complete','approved_live_reconciliation',true),
   'governed_migration_record_only','high',1,1,0,JSON_ARRAY('migration_preflight_pass','complete_schema_evidence'),
   JSON_ARRAY('governed_migration_reconciliation'),'active',
   'Live schema evidence is complete; reconcile the missing ledger row without replaying SQL.'),
  ('migration_reconcile_306_apply','governed_migration_reconciliation_v1','governed_migration_reconciliation_engine',
   200,'migration_reconcile','sql','306_sprint69_session_insight_target_write_readback.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',true),
   'governed_migration_apply','high',1,1,0,JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback'),
   JSON_ARRAY('governed_migration_reconciliation'),'active',
   'Apply only while required schema objects remain incomplete and governed runner authorization permits apply.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key), engine_key = VALUES(engine_key), priority = VALUES(priority),
  task_class = VALUES(task_class), resource_kind = VALUES(resource_kind), resource_pattern = VALUES(resource_pattern),
  condition_json = VALUES(condition_json), strategy_key = VALUES(strategy_key), risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed), dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required), validator_commands_json = VALUES(validator_commands_json),
  required_skill_keys_json = VALUES(required_skill_keys_json), status = VALUES(status), notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version, task_classes_json,
   required_tools_json, forbidden_tools_json, validator_commands_json, success_criteria_json,
   fallback_behavior_json, prompt_template, status, notes)
VALUES
  ('governed_migration_reconciliation','governed_migration_reconciliation_engine',
   'Governed Migration Reconciliation','v1',JSON_ARRAY('migration_reconcile'),
   JSON_ARRAY('governed-migration-runner.mjs'),JSON_ARRAY('raw_sql_execution','db_stored_executable_code'),
   JSON_ARRAY('migration_preflight_pass','schema_evidence_readback'),
   JSON_ARRAY('matching_checksum_ledger_evidence','no_unauthorized_apply','dynamic_audit_event_written'),
   JSON_OBJECT('on_missing_rule','diagnose_only','on_missing_authorization','blocked'),
   'Discover migration drift, resolve exact DB policy, prefer record-only for complete schema, apply only explicit authorized gaps, validate, and audit.',
   'active','Skill-bound contract for deterministic migration reconciliation decisions.')
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key), display_name = VALUES(display_name), prompt_contract_version = VALUES(prompt_contract_version),
  task_classes_json = VALUES(task_classes_json), required_tools_json = VALUES(required_tools_json),
  forbidden_tools_json = VALUES(forbidden_tools_json), validator_commands_json = VALUES(validator_commands_json),
  success_criteria_json = VALUES(success_criteria_json), fallback_behavior_json = VALUES(fallback_behavior_json),
  prompt_template = VALUES(prompt_template), status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('308_sprint69_dynamic_governed_migration_reconciliation.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize the additive deny-by-default governed migration reconciliation control plane.',
   JSON_OBJECT('scope','governed_migration_reconciliation','secrets_included', false))
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
