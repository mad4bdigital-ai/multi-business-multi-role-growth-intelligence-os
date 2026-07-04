-- Sprint 69: remove the temporary SHA-bound cleanup override used for merged PR 1950.
-- The target branch has already been deleted with same-cycle readback. This migration removes only that branch-specific override.
-- No branch mutation, provider call, force update, credential access, or secret handling occurs here.

UPDATE execution_policies
   SET policy_value = JSON_REMOVE(
     COALESCE(NULLIF(policy_value, ''), '{}'),
     '$.superseded_branch_delete_branch_overrides."gpt/006-sql-cache-dynamic-safety-20260628"'
   )
 WHERE policy_group = 'Repository Mutation Governance'
   AND policy_key = 'Stale Duplicate Branch Merge Guard'
   AND active = 'TRUE'
   AND blocking = 'TRUE'
   AND JSON_EXTRACT(
     policy_value,
     '$.superseded_branch_delete_branch_overrides."gpt/006-sql-cache-dynamic-safety-20260628"'
   ) IS NOT NULL;
