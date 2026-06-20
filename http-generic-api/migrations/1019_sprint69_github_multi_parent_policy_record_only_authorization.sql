-- 1019_sprint69_github_multi_parent_policy_record_only_authorization.sql
-- Purpose: authorize checksum-bound record-only reconciliation for the already-effective
-- GitHub multi-parent merge policy migration without allowing SQL re-apply.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
   approval_required, validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_1014_github_multi_parent_policy_record_only',
   'governed_migration_reconciliation_v1',
   'governed_migration_reconciliation_engine',
   275,
   'migration_reconcile',
   'sql',
   '1014_sprint69_github_branch_multi_parent_merge_commit_policy.sql',
   JSON_OBJECT(
     'required_schema_state', 'not_applicable',
     'policy_only_record_only', TRUE,
     'registry_only', TRUE,
     'approved_live_reconciliation', TRUE,
     'expected_checksum_sha256', '84ff6a7a767223389b3202b4bd3388d510c04e3b0e0074ab53cd8bcb3f1cdbe0'
   ),
   'governed_migration_record_only',
   'low',
   1,
   1,
   0,
   JSON_ARRAY('migration_preflight_pass', 'checksum_match', 'policy_only_record_only_contract'),
   JSON_ARRAY('governed_migration_reconciliation'),
   'active',
   'Record migration 1014 only when its exact checksum matches the reviewed policy-only artifact. SQL apply is forbidden.')
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
  ('1014_sprint69_github_branch_multi_parent_merge_commit_policy.sql',
   'authorized',
   'platform_admin_review',
   'governed_migration_runner_authorization_v1',
   'low',
   1,
   1,
   1,
   0,
   'Checksum-bound record-only reconciliation for an already-effective registry policy migration. SQL apply is forbidden.',
   JSON_OBJECT(
     'scope', 'github_multi_parent_merge_commit_policy',
     'record_only', TRUE,
     'allow_apply', FALSE,
     'expected_checksum_sha256', '84ff6a7a767223389b3202b4bd3388d510c04e3b0e0074ab53cd8bcb3f1cdbe0',
     'secrets_included', FALSE
   )),
  ('1019_sprint69_github_multi_parent_policy_record_only_authorization.sql',
   'authorized',
   'migration_seed',
   'governed_migration_runner_authorization_v1',
   'low',
   1,
   1,
   1,
   1,
   'Registry-only authorization and rule closure for migration 1014 record-only reconciliation.',
   JSON_OBJECT(
     'scope', 'governed_migration_reconciliation',
     'registry_only', TRUE,
     'secrets_included', FALSE
   ))
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
