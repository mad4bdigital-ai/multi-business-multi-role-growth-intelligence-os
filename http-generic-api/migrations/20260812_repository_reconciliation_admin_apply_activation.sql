-- Repository reconciliation governed apply activation.
-- This migration is intentionally separate from 1026 so a release can stage the
-- orchestration schema/code first and activate mutation only through the governed
-- migration path after CI and runtime readiness are green.

SET @repo_reconcile_recipe_ready := (
  SELECT COUNT(*)
    FROM platform_resource_recipes
   WHERE recipe_key = 'repo.pr.reconcile_and_finalize'
     AND engine_key = 'repository_reconciliation_orchestrator'
     AND requires_dry_run = 1
     AND requires_capability_envelope = 1
     AND requires_typed_confirmation = 1
     AND requires_same_cycle_readback = 1
);

SET @repo_reconcile_step_count := (
  SELECT COUNT(*)
    FROM platform_resource_recipe_steps
   WHERE recipe_key = 'repo.pr.reconcile_and_finalize'
     AND status = 'active'
     AND step_key IN (
       'acquire_branch_lease','reconcile_branch','build_resolution_commit',
       'create_merge_commit','verify_branch','evaluate_ci','finalize_pr',
       'release_branch_lease','emit_evidence'
     )
);

SET @repo_reconcile_activation_sql := IF(
  @repo_reconcile_recipe_ready = 1 AND @repo_reconcile_step_count = 9,
  "UPDATE platform_resource_recipes SET status='active', notes='Governed apply surface exposed with plan-bound global authority, exclusive lease, exact resolution-scope binding, per-step capability/approval/confirmation, required CI gate, no-force mutation, and same-cycle readback.', updated_at=CURRENT_TIMESTAMP WHERE recipe_key='repo.pr.reconcile_and_finalize'",
  "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='repository_reconciliation_activation_preconditions_failed'"
);
PREPARE repo_reconcile_activation_stmt FROM @repo_reconcile_activation_sql;
EXECUTE repo_reconcile_activation_stmt;
DEALLOCATE PREPARE repo_reconcile_activation_stmt;

UPDATE execution_policies
   SET policy_value = JSON_SET(
         COALESCE(policy_value, JSON_OBJECT()),
         '$.recipe_status', 'active',
         '$.admin_apply_surface_exposed', TRUE,
         '$.provider_executor_implemented', TRUE,
         '$.engine_executor_implemented', TRUE,
         '$.exact_resolution_scope_bound', TRUE,
         '$.per_step_plan_authority_required', TRUE,
         '$.force_push_allowed', FALSE,
         '$.migration_apply_allowed', FALSE,
         '$.automatic_activation_allowed', FALSE
       ),
       notes = 'Repository reconciliation apply is active only through the governed admin surface and remains fail-closed on stale refs, authority drift, CI gaps, replay, or readback failure.',
       updated_at = CURRENT_TIMESTAMP
 WHERE policy_group = 'Repository Mutation Governance'
   AND policy_key = 'repository_reconciliation_automation_v1';

CREATE OR REPLACE VIEW v_repository_reconciliation_apply_readiness AS
SELECT
  r.recipe_key,
  r.status AS recipe_status,
  r.engine_key,
  r.requires_dry_run,
  r.requires_capability_envelope,
  r.requires_typed_confirmation,
  r.requires_same_cycle_readback,
  (SELECT COUNT(*) FROM platform_resource_recipe_steps s
    WHERE s.recipe_key=r.recipe_key AND s.status='active') AS active_step_count,
  CASE
    WHEN r.status='active'
     AND r.engine_key='repository_reconciliation_orchestrator'
     AND r.requires_dry_run=1
     AND r.requires_capability_envelope=1
     AND r.requires_typed_confirmation=1
     AND r.requires_same_cycle_readback=1
     AND (SELECT COUNT(*) FROM platform_resource_recipe_steps s WHERE s.recipe_key=r.recipe_key AND s.status='active')=9
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status
FROM platform_resource_recipes r
WHERE r.recipe_key='repo.pr.reconcile_and_finalize';
