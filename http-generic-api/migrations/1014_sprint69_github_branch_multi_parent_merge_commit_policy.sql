-- Sprint 69: governed GitHub multi-parent merge commit policy (migration 1014)
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false
-- Registers a capability-envelope-gated recipe for reconciling diverged non-protected work branches.
-- The recipe never updates the default branch. It creates one merge commit whose parents are
-- [expected work-branch head, expected default-branch head] and whose tree comes from an explicit
-- reviewed resolution commit based directly on the expected default-branch head.

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
  'GitHub Branch Multi-Parent Merge Commit Recipe Contract',
  JSON_OBJECT(
    'rule','github_branch_merge_commit_requires_explicit_resolution_and_same_cycle_readback',
    'tool_key','github_branch_merge_commit_create',
    'recipe_key','github.branch.create_multi_parent_merge_commit',
    'adapter_key','admin-branch-reconciliation-v1',
    'resource_scope','repository',
    'actor_scope','admin_only',
    'mutation_type','github_commit_create_and_non_force_ref_update',
    'applies_only_when_classification',JSON_ARRAY('diverged_no_overlap','diverged_same_files'),
    'requires_prior_tool','admin_branch_reconcile',
    'requires_expected_base_sha',true,
    'requires_expected_branch_sha',true,
    'requires_resolution_commit_sha',true,
    'requires_capability_envelope',true,
    'requires_typed_confirmation','CREATE_MERGE_COMMIT_<BRANCH_SLUG>',
    'protected_branches_blocked',JSON_ARRAY('main','master','production','prod','staging','release'),
    'allowed_branch_prefixes',JSON_ARRAY('gpt/','chore/','fix/','feature/','docs/','hotfix/'),
    'resolution_commit_contract',JSON_OBJECT(
      'sole_parent_must_equal_expected_base_sha',true,
      'tree_must_exist',true,
      'must_not_be_behind_expected_base',true,
      'must_cover_all_work_branch_changed_files',true,
      'must_not_change_files_outside_work_branch_scope',true,
      'resolution_commit_is_not_applied_directly',true
    ),
    'merge_commit_contract',JSON_OBJECT(
      'parent_order',JSON_ARRAY('expected_branch_sha','expected_base_sha'),
      'tree_source','validated_resolution_commit_tree',
      'github_ref_update_force',false,
      'default_branch_update_allowed',false,
      'delete_allowed',false,
      'same_cycle_ref_readback_required',true,
      'same_cycle_parent_readback_required',true,
      'same_cycle_tree_readback_required',true,
      'expected_readback_classification','ahead_only',
      'expected_behind_by',0
    ),
    'blocked_states',JSON_ARRAY(
      'protected_branch',
      'up_to_date',
      'ahead_only',
      'behind_only',
      'missing_capability_envelope',
      'missing_expected_sha_evidence',
      'stale_dry_run_evidence',
      'resolution_commit_parent_mismatch',
      'resolution_commit_tree_missing',
      'resolution_commit_scope_mismatch',
      'resolution_commit_missing_branch_file',
      'secret_material_in_checkpoint'
    ),
    'audit_contract',JSON_OBJECT(
      'must_include',JSON_ARRAY('target','before','resolution','commit','update','after','verification','capability_envelope_id'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,branch_reconciliation,github_commit_create,github_ref_update,capability_envelope',
  'adminBranchReconciliationAdapter,gptToolsRoutes,sharedReconciliationEngine,github_branch_merge_commit_create,admin_branch_reconcile',
  'TRUE',
  'Diverged work branches may be reconciled only through a reviewed resolution commit, fresh expected SHAs, capability approval, typed confirmation, a two-parent merge commit, force=false ref update, same-cycle ancestry/tree/readback verification, and no-secret audit evidence.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
