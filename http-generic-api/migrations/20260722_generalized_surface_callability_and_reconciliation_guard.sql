-- Generalized surface callability and repository reconciliation guard.
-- Additive and idempotent registry activation only. This migration is not applied by this PR.
-- No provider call, repository write, force push, PR merge, credential read, or secret return occurs here.

UPDATE `platform_resource_recipes`
   SET `status` = 'active',
       `read_only` = 0,
       `requires_dry_run` = 1,
       `requires_capability_envelope` = 1,
       `requires_typed_confirmation` = 1,
       `requires_same_cycle_readback` = 1,
       `policy_json` = JSON_SET(
         COALESCE(`policy_json`, JSON_OBJECT()),
         '$.status', 'active',
         '$.orchestrator_surface', 'repository_reconciliation_orchestrator',
         '$.orchestrator_lease_required', TRUE,
         '$.low_level_merge_without_lease_forbidden', TRUE,
         '$.exact_base_and_branch_sha_required', TRUE,
         '$.same_cycle_ref_tree_ancestry_readback_required', TRUE,
         '$.provider_write_requires_action_specific_capability_envelope', TRUE,
         '$.protected_branch_direct_write_allowed', FALSE,
         '$.force_push_allowed', FALSE,
         '$.migration_apply_allowed', FALSE,
         '$.automatic_activation_allowed', FALSE,
         '$.secrets_included', FALSE
       ),
       `notes` = 'Active only through the governed reconciliation orchestrator. Each mutation step requires its own approved capability envelope and typed confirmation. Multi-parent merge commits require the active orchestrator-held repository lease and same-cycle readback.',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `recipe_key` = 'repo.pr.reconcile_and_finalize';

UPDATE `execution_policies`
   SET `policy_value` = JSON_SET(
         COALESCE(`policy_value`, JSON_OBJECT()),
         '$.recipe_status', 'active',
         '$.orchestrator_surface', 'repository_reconciliation_orchestrator',
         '$.orchestrator_lease_required', TRUE,
         '$.low_level_merge_without_lease_forbidden', TRUE,
         '$.exact_base_and_branch_sha_required', TRUE,
         '$.same_cycle_ref_tree_ancestry_readback_required', TRUE,
         '$.force_push_allowed', FALSE,
         '$.protected_branch_direct_write_allowed', FALSE,
         '$.migration_apply_allowed', FALSE,
         '$.automatic_activation_allowed', FALSE,
         '$.secrets_included', FALSE
       ),
       `active` = 'TRUE',
       `blocking` = 'TRUE',
       `execution_scope` = 'repository_reconciliation|repo_mutation|pull_request_merge|branch_update|github_branch_merge_commit_create',
       `affects_layer` = 'repositoryReconciliationOrchestrator|repositoryOperationLeaseService|adminBranchReconciliationAdapter|repository_mutation_runs_v6|platform_resource_recipes',
       `notes` = 'Blocks low-level reconciliation merge commits unless the active orchestrator lease, exact SHAs, action-specific approval, and same-cycle readback are present.',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `policy_group` = 'Repository Mutation Governance'
   AND `policy_key` = 'repository_reconciliation_automation_v1';
