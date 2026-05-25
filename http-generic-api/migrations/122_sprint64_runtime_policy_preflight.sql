-- Sprint 64: Runtime policy preflight seed
-- Restores execution_policies as a runtime authority source for repo/GitHub mutations.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'repo_mutation|github_pr_merge|branch_delete',
       `affects_layer` = 'adminCliRoutes|github_rest_fallback|repo_patch_apply',
       `blocking` = 'TRUE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'blocking',
         'require_compare_main_branch', true,
         'block_unmerged_branch_delete', true,
         'block_risky_file_statuses', true,
         'risky_file_statuses', 'removed',
         'require_mergeability_check', true,
         'reason', 'Prevent stale duplicate or unreviewed branches from being merged/deleted without runtime policy evidence.'
       ),
       `notes` = 'Runtime preflight policy for GitHub/repo mutation safety. Used by governedExecutionPreflight before PR merge and branch delete. Blocks protected branch delete, unmerged branch delete, non-mergeable PRs, and risky removed-file merges.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Repository Mutation Governance'
   AND `policy_key` = 'Stale Duplicate Branch Merge Guard';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'Repository Mutation Governance',
  'Stale Duplicate Branch Merge Guard',
  JSON_OBJECT(
    'enforcement_mode', 'blocking',
    'require_compare_main_branch', true,
    'block_unmerged_branch_delete', true,
    'block_risky_file_statuses', true,
    'risky_file_statuses', 'removed',
    'require_mergeability_check', true,
    'reason', 'Prevent stale duplicate or unreviewed branches from being merged/deleted without runtime policy evidence.'
  ),
  'TRUE',
  'repo_mutation|github_pr_merge|branch_delete',
  'adminCliRoutes|github_rest_fallback|repo_patch_apply',
  'TRUE',
  'Runtime preflight policy for GitHub/repo mutation safety. Used by governedExecutionPreflight before PR merge and branch delete. Blocks protected branch delete, unmerged branch delete, non-mergeable PRs, and risky removed-file merges.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'Repository Mutation Governance'
     AND `policy_key` = 'Stale Duplicate Branch Merge Guard'
);
