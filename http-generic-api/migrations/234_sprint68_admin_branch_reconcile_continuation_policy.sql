-- Sprint 68: Admin branch reconcile continuation policy
-- Adds a governed adapter contract for diagnosing stale/diverged repository work branches.
-- Apply is intentionally narrow: only non-protected behind-only branches may be fast-forwarded with explicit confirmation.

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
  'Admin Branch Reconcile Continuation Contract',
  JSON_OBJECT(
    'rule','admin_branch_reconcile_continuation_contract',
    'tool_key','admin_branch_reconcile',
    'adapter','admin_branch_reconcile',
    'trigger_conditions',JSON_ARRAY('repo_patch_stale_branch_requires_explicit_override','branch_diverged','behind_only_branch','stale_work_branch'),
    'allowed_actions',JSON_ARRAY('diagnose','dry_run','apply'),
    'apply_scope',JSON_OBJECT(
      'allowed_only_for','behind_only_non_protected_branch',
      'required_confirmation_format','FAST_FORWARD_<BRANCH_SLUG>',
      'github_ref_update_force',false,
      'protected_branches_blocked',JSON_ARRAY('main','master','production','prod','staging','release')
    ),
    'blocked_apply_classes',JSON_ARRAY('diverged','ahead_only','unknown','protected_branch','default_branch'),
    'required_sequence',JSON_ARRAY(
      'fetch_base_ref',
      'fetch_branch_ref',
      'compare_base_to_branch',
      'classify_branch_state',
      'create_no_secret_continuation_checkpoint',
      'dry_run_repair_plan',
      'apply_fast_forward_only_if_behind_only_and_confirmed',
      'verify_compare_after_apply',
      'audit',
      'resume_original_operation'
    ),
    'checkpoint_contract',JSON_OBJECT(
      'engine','shared-reconciliation-continuation-v1',
      'resource_type','git_branch_reconciliation',
      'resource_scope','repository',
      'interruption_signal_for_drift','branch_diverged',
      'must_include',JSON_ARRAY('operation_key','actor_scope','resource_scope','resource_fingerprint','classification','compare_status','ahead_by','behind_by','current_stage'),
      'must_exclude',JSON_ARRAY('github_token','access_token','raw_secret','private_key','password','authorization'),
      'secrets_included',false
    ),
    'forbidden_behaviors',JSON_ARRAY(
      'force_push_diverged_branch',
      'fast_forward_protected_or_default_branch',
      'apply_without_confirmation',
      'claim_reconciled_without_post_apply_compare_readback',
      'include_github_token_or_secret_in_response_or_audit'
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,repo_patch_apply,branch_reconciliation,github_branch_maintenance',
  'gptToolsRoutes,admin_branch_reconcile,sharedReconciliationEngine,repo_patch_apply,github_rest_ref_update',
  'TRUE',
  'Repository branch drift must be diagnosed with no-secret continuation evidence; only behind-only non-protected branches may be fast-forwarded without force after explicit confirmation.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
