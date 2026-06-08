-- Sprint 68: Admin branch reconciliation policy
-- Registers the dry-run-first branch reconciliation adapter for repository drift recovery.
-- Pattern: detect branch drift -> classify risk -> no-secret continuation checkpoint -> dry-run plan -> gated apply by explicit confirmation.

INSERT INTO execution_policies (
  policy_group,
  policy_key,
  policy_value,
  active,
  execution_scope,
  affects_layer,
  blocking,
  notes
) VALUES (
  'Repository Mutation Governance',
  'Admin Branch Reconciliation Adapter Contract',
  JSON_OBJECT(
    'rule','admin_branch_reconcile_requires_dry_run_and_checkpoint',
    'tool_key','admin_branch_reconcile',
    'adapter_key','admin_branch_reconciliation_v1',
    'resource_scope','repository',
    'actor_scope','admin_only',
    'protected_branches_blocked',JSON_ARRAY('main','master','production','prod','staging','release'),
    'allowed_branch_prefixes',JSON_ARRAY('gpt/','chore/','fix/','feature/','docs/','hotfix/'),
    'classifications',JSON_ARRAY(
      'up_to_date',
      'behind_only',
      'ahead_only',
      'diverged_no_overlap',
      'diverged_same_files',
      'unsafe_dirty_tree',
      'protected_branch_blocked'
    ),
    'required_sequence',JSON_ARRAY(
      'load_repository_authority',
      'fetch_base_and_branch_refs',
      'compare_base_to_branch',
      'compare_branch_to_base',
      'classify_branch_drift',
      'build_no_secret_continuation_checkpoint',
      'dry_run_repair_plan',
      'verify_required_checks',
      'apply_only_after_explicit_confirmation',
      'audit_and_resume_original_operation'
    ),
    'checkpoint_contract',JSON_OBJECT(
      'uses_shared_reconciliation_engine',true,
      'interruption_signal','branch_diverged',
      'must_include',JSON_ARRAY('operation_key','actor_scope','resource_scope','resource_fingerprint','current_stage','interruption_signal','resume_metadata'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'apply_gate',JSON_OBJECT(
      'v1_apply_supported',false,
      'future_apply_requires',JSON_ARRAY('explicit_confirmation','dry_run_ok','verify_ok','targeted_tests_ok','audit_payload_ready'),
      'blocked_states',JSON_ARRAY('protected_branch','same_file_divergence','dirty_tree','missing_checkpoint','scope_mismatch','secret_material_in_checkpoint')
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,branch_reconciliation,repo_patch_apply,github_rest_fallback',
  'adminBranchReconciliationAdapter,gptToolsRoutes,sharedReconciliationEngine,repo_patch_apply,admin_branch_reconcile',
  'TRUE',
  'Repository branch drift recovery must run an admin-only dry-run reconciliation plan with no-secret continuation evidence before any branch update, rebase, merge, or fallback mutation.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
