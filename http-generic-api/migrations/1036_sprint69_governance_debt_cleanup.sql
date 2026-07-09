-- Sprint 69: Governed cleanup for expired capability envelopes and stale migration authorizations.
-- This migration is intentionally internal-only: no provider calls, no credential reads, no raw secrets,
-- no external sends, no external writes, and no deletion.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'platform_resource_authority_grant_apply',
    'Platform Resource Authority Grant Apply',
    'Create a bounded resource authority binding for governed admin operations. Dry-run by default; apply requires TTL, expected commit SHA, typed confirmation, and same-cycle readback. No secrets.',
    'POST',
    '/admin/resource-authority/grants',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY('tenant_id','workspace_id','user_id','resource_type','resource_uri','recipe_key','resource_ref'),
      'properties', JSON_OBJECT(
        'mode', JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
        'tenant_id', JSON_OBJECT('type','string','format','uuid'),
        'workspace_id', JSON_OBJECT('type','string','format','uuid'),
        'user_id', JSON_OBJECT('type','string','format','uuid'),
        'resource_type', JSON_OBJECT('type','string','enum',JSON_ARRAY('github_repo')),
        'resource_uri', JSON_OBJECT('type','string','pattern','^github://[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
        'recipe_key', JSON_OBJECT('type','string','enum',JSON_ARRAY('repo_patch_apply','repo_patch_batch_apply','github_pr_create')),
        'permission_level', JSON_OBJECT('type','string','enum',JSON_ARRAY('patch','admin')),
        'allowed_modes', JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8),
        'resource_ref', JSON_OBJECT('type','object','required',JSON_ARRAY('branch'),'additionalProperties',true),
        'ttl_minutes', JSON_OBJECT('type','integer','minimum',5,'maximum',1440),
        'confirm', JSON_OBJECT('type','string'),
        'notes', JSON_OBJECT('type','string','maxLength',1000),
        'created_by', JSON_OBJECT('type','string','maxLength',64)
      ),
      'additionalProperties', false
    ),
    NULL,
    'admin,resource_authority,state_changing,dry_run_default,typed_confirmation,readback,no_provider_call,no_external_write,no_secrets',
    1,
    342
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  (
    '20260704_platform_resource_authority_grant_tool.sql',
    'disabled',
    '1036_sprint69_governance_debt_cleanup',
    'governed_migration_runner_authorization_v1',
    'medium',
    1,
    1,
    1,
    0,
    'Disabled as stale after the platform_resource_authority_grant_apply registry row was reconciled by 1036_sprint69_governance_debt_cleanup.sql. The original file used retired authorization-registry columns and is intentionally not applyable.',
    JSON_OBJECT('disabled_by_migration','1036_sprint69_governance_debt_cleanup.sql','superseded_migration',true,'secrets_included',false)
  ),
  (
    '20260705_registry_skill_recovery_and_execution_log_certification.sql',
    'disabled',
    '1036_sprint69_governance_debt_cleanup',
    'governed_migration_runner_authorization_v1',
    'medium',
    1,
    1,
    1,
    0,
    'Disabled as stale authorization because the migration file is not present on the current main branch and has no governed ledger entry. No migration SQL is executed by this classification.',
    JSON_OBJECT('disabled_by_migration','1036_sprint69_governance_debt_cleanup.sql','stale_authorization_without_main_file',true,'secrets_included',false)
  ),
  (
    '1004_sprint69_growth_agent_migration_reconciliation_policy.sql',
    'disabled',
    '1036_sprint69_governance_debt_cleanup',
    'governed_migration_runner_authorization_v1',
    'medium',
    1,
    1,
    1,
    0,
    'Disabled as stale authorization because the migration file is not present on the current main branch and has no governed ledger entry. No migration SQL is executed by this classification.',
    JSON_OBJECT('disabled_by_migration','1036_sprint69_governance_debt_cleanup.sql','stale_authorization_without_main_file',true,'secrets_included',false)
  )
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

UPDATE capability_resolution_envelope_ledger
   SET envelope_status = 'expired',
       dispatch_allowed = 0,
       apply_allowed = 0,
       updated_at = CURRENT_TIMESTAMP
 WHERE expires_at IS NOT NULL
   AND expires_at < UTC_TIMESTAMP()
   AND envelope_status IN ('ready_for_dispatch','ready_requires_approval','dry_run')
   AND execution_status <> 'executed';
