-- Sprint 68: GitHub branch fast-forward smoke policy (migration 251)
-- Registers the disposable end-to-end smoke for the guarded branch fast-forward recipe.
-- Pattern: create gpt/fast-forward-smoke-* at default parent -> dry-run behind_only -> guarded fast-forward -> readback -> cleanup.

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
  'GitHub Branch Fast Forward Smoke Contract',
  JSON_OBJECT(
    'rule','github_branch_fast_forward_smoke_requires_disposable_branch_cleanup_and_capability_envelope',
    'tool_key','github_branch_fast_forward_smoke',
    'recipe_key','github.branch.fast_forward_smoke',
    'adapter_key','admin-branch-reconciliation-v1',
    'resource_scope','repository',
    'actor_scope','admin_only',
    'mutation_type','disposable_github_ref_create_update_delete',
    'branch_prefix_required','gpt/fast-forward-smoke-',
    'requires_capability_envelope',true,
    'creates_branch_at','default_branch_parent_commit',
    'requires_dry_run_classification','behind_only',
    'delegates_apply_to','github_branch_fast_forward_to_base',
    'github_ref_update',JSON_OBJECT(
      'force',false,
      'same_cycle_readback_required',true,
      'expected_readback_classification','up_to_date',
      'delete_allowed_for_smoke_branch_only',true,
      'protected_branch_update_allowed',false
    ),
    'cleanup_contract',JSON_OBJECT(
      'cleanup_required',true,
      'cleanup_ref_prefix','refs/heads/gpt/fast-forward-smoke-',
      'cleanup_in_finally',true,
      'cleanup_result_required_in_response',true,
      'secrets_included',false
    ),
    'blocked_states',JSON_ARRAY(
      'protected_branch',
      'non_smoke_branch_prefix',
      'missing_capability_envelope',
      'parent_commit_unavailable',
      'unexpected_classification',
      'stale_dry_run_evidence',
      'readback_not_up_to_date',
      'secret_material_in_evidence'
    ),
    'audit_contract',JSON_OBJECT(
      'must_include',JSON_ARRAY('target','setup','dry_run','apply','cleanup','capability_envelope_id'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,branch_reconciliation,github_ref_update,capability_envelope,smoke_validation',
  'adminBranchReconciliationAdapter,gptToolsRoutes,github_branch_fast_forward_smoke,github_branch_fast_forward_to_base,admin_branch_reconcile',
  'TRUE',
  'GitHub branch fast-forward smoke is an admin-only disposable-branch validation recipe requiring capability envelope approval, behind_only dry-run evidence, no-force update, same-cycle readback, and mandatory cleanup evidence.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
