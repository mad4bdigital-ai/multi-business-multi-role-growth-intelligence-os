-- Correct Repository Conflict Intelligence registry metadata for no-mutation POST surfaces.
-- These endpoints analyze, plan, or preview only. They do not mutate Git or call provider writes.

UPDATE admin_platform_endpoint_tools
SET tags = CASE tool_key
  WHEN 'repo_conflict_intelligence_plan' THEN 'repo_conflict_intelligence,admin,planner,read_only,preview_only,no_provider_call,no_secrets'
  WHEN 'repo_conflict_intelligence_resolve_dry_run' THEN 'repo_conflict_intelligence,admin,dry_run,read_only,preview_only,no_provider_write,no_git_mutation,no_secrets,capability_planning'
  WHEN 'repo_conflict_intelligence_pr_automation_preview' THEN 'repo_conflict_intelligence,admin,automation_preview,comment_plan,read_only,preview_only,no_provider_write,no_secrets'
  ELSE tags
END
WHERE tool_key IN (
  'repo_conflict_intelligence_plan',
  'repo_conflict_intelligence_resolve_dry_run',
  'repo_conflict_intelligence_pr_automation_preview'
);

UPDATE tenant_platform_endpoint_tools
SET tags = CASE tool_key
  WHEN 'tenant_repo_conflict_intelligence_plan' THEN 'repo_conflict_intelligence,tenant,planner,read_only,preview_only,request_only,no_secrets'
  WHEN 'tenant_repo_conflict_intelligence_resolve_dry_run' THEN 'repo_conflict_intelligence,tenant,dry_run,read_only,preview_only,request_only,no_provider_write,no_git_mutation,no_secrets'
  ELSE tags
END
WHERE tool_key IN (
  'tenant_repo_conflict_intelligence_plan',
  'tenant_repo_conflict_intelligence_resolve_dry_run'
);
