-- 1014_sprint69_approval_hold_collation_reconciliation_rule.sql
-- Purpose: add the exact governed reconciliation rule for migration 1013.
-- Safety: registry-only, additive/idempotent, no provider calls, no external writes,
-- no credential payload reads, no raw secrets, secrets_included=false.

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
   approval_required, validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_1013_apply',
   'governed_migration_reconciliation_v1',
   'governed_migration_reconciliation_engine',
   250,
   'migration_reconcile',
   'sql',
   '1013_sprint69_approval_hold_identity_collation_alignment.sql',
   JSON_OBJECT(
     'required_schema_state', 'incomplete',
     'approved_live_reconciliation', true,
     'approved_exact_alter_contract', 'approval_hold_identity_collation_v1',
     'expected_alter_count', 4
   ),
   'governed_migration_apply',
   'high',
   1,
   1,
   0,
   JSON_ARRAY('migration_preflight_pass', 'post_apply_schema_readback'),
   JSON_ARRAY('governed_migration_reconciliation'),
   'active',
   'Apply migration 1013 only while the approval-hold collation readiness view is absent and the exact bounded preflight contract passes.')
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

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('1013_sprint69_approval_hold_identity_collation_alignment.sql',
   'authorized', 'governed_admin_bootstrap', 'governed_migration_runner_authorization_v1',
   'medium', 1, 1, 0, 1,
   'Exact Approval Hold identity collation repair; apply only through the explicit reconciliation rule and governed runner.',
   JSON_OBJECT('scope', 'approval_hold_identity_collation_v1', 'expected_alter_count', 4, 'secrets_included', false)),
  ('1014_sprint69_approval_hold_collation_reconciliation_rule.sql',
   'authorized', 'migration_seed', 'governed_migration_runner_authorization_v1',
   'low', 1, 1, 1, 1,
   'Registry-only rule and authorization closure for migration 1013 reconciliation.',
   JSON_OBJECT('scope', 'governed_migration_reconciliation', 'registry_only', true, 'secrets_included', false))
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
