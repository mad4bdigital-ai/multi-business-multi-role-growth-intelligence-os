-- Sprint 69: temporary SHA-bound superseded-branch cleanup override for merged PR 1950.
-- Scope is one branch only. The override expires automatically and becomes invalid if the branch SHA changes.
-- No branch deletion, provider call, force update, credential access, or secret handling occurs in this migration.

UPDATE execution_policies
   SET policy_value = JSON_SET(
     COALESCE(NULLIF(policy_value, ''), '{}'),
     '$.superseded_branch_delete_branch_overrides."gpt/006-sql-cache-dynamic-safety-20260628"',
     JSON_OBJECT(
       'max_ahead_commits', 40,
       'expected_branch_sha', 'fb3a6b6b6c48e0d1c8cc1658e482dbace20cbd97',
       'expires_at', '2026-07-02T23:59:59.000Z',
       'reason', 'Temporary SHA-bound cleanup authorization for merged PR 1950 after every changed file was verified covered by commits on main.'
     )
   )
 WHERE policy_group = 'Repository Mutation Governance'
   AND policy_key = 'Stale Duplicate Branch Merge Guard'
   AND active = 'TRUE'
   AND blocking = 'TRUE';
