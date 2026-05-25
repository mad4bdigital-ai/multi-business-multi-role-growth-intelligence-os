-- Sprint 64: Extend runtime policy preflight to GPT tools dispatch and repo_patch_apply.

UPDATE `execution_policies`
   SET `execution_scope` = 'repo_mutation|github_pr_merge|branch_delete|repo_patch_apply|gpt_tools_call|tool_dispatch',
       `affects_layer` = 'adminCliRoutes|github_rest_fallback|gptToolsRoutes|repo_patch_apply',
       `blocking` = 'TRUE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'blocking',
         'require_compare_main_branch', true,
         'block_unmerged_branch_delete', true,
         'block_risky_file_statuses', true,
         'risky_file_statuses', 'removed',
         'require_mergeability_check', true,
         'block_stale_branch_patch', true,
         'require_stale_branch_reason', true,
         'reason', 'Prevent stale duplicate or unreviewed branches from being merged, deleted, or patched without runtime policy evidence.'
       ),
       `notes` = 'Runtime preflight policy for GitHub/repo mutation safety. Used by governedExecutionPreflight before PR merge, branch delete, GPT tool dispatch, and repo_patch_apply. Blocks protected branch delete, unmerged branch delete, non-mergeable PRs, risky removed-file merges, and stale existing-branch patching without an explicit reason.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Repository Mutation Governance'
   AND `policy_key` = 'Stale Duplicate Branch Merge Guard';
