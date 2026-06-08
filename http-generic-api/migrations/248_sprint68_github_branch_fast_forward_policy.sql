-- Sprint 68: GitHub branch fast-forward recipe policy (migration 248)
-- Registers a separate, capability-envelope-gated mutation recipe for behind_only work branches.
-- Pattern: admin_branch_reconcile dry-run -> expected SHA evidence -> capability envelope -> typed confirmation -> force=false ref update -> same-cycle readback.

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
  'GitHub Branch Fast Forward To Base Recipe Contract',
  JSON_OBJECT(
    'rule','github_branch_fast_forward_requires_dry_run_evidence_and_capability_envelope',
    'tool_key','github_branch_fast_forward_to_base',
    'recipe_key','github.branch.fast_forward_to_base',
    'adapter_key','admin-branch-reconciliation-v1',
    'resource_scope','repository',
    'actor_scope','admin_only',
    'mutation_type','github_ref_update',
    'applies_only_when_classification','behind_only',
    'requires_prior_tool','admin_branch_reconcile',
    'requires_expected_base_sha',true,
    'requires_expected_branch_sha',true,
    'requires_capability_envelope',true,
    'requires_typed_confirmation','RECONCILE_BRANCH_<BRANCH_SLUG>',
    'protected_branches_blocked',JSON_ARRAY('main','master','production','prod','staging','release'),
    'allowed_branch_prefixes',JSON_ARRAY('gpt/','chore/','fix/','feature/','docs/','hotfix/'),
    'github_ref_update',JSON_OBJECT(
      'force',false,
      'same_cycle_readback_required',true,
      'expected_readback_classification','up_to_date',
      'delete_allowed',false,
      'protected_branch_update_allowed',false
    ),
    'blocked_states',JSON_ARRAY(
      'protected_branch',
      'same_file_divergence',
      'dirty_tree',
      'ahead_only',
      'diverged_no_overlap',
      'diverged_same_files',
      'missing_capability_envelope',
      'missing_expected_sha_evidence',
      'stale_dry_run_evidence',
      'secret_material_in_checkpoint'
    ),
    'audit_contract',JSON_OBJECT(
      'must_include',JSON_ARRAY('target','before','update','after','verification','capability_envelope_id'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,branch_reconciliation,github_ref_update,capability_envelope',
  'adminBranchReconciliationAdapter,gptToolsRoutes,sharedReconciliationEngine,github_branch_fast_forward_to_base,admin_branch_reconcile',
  'TRUE',
  'GitHub branch fast-forward to base is allowed only as a separate admin-only mutation recipe after fresh dry-run evidence, explicit capability envelope approval, typed confirmation, force=false update, same-cycle readback, and no-secret audit evidence.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
