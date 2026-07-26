-- Require explicit no-write and request-only metadata for all Tenant Repository Conflict Intelligence tools.
-- The readiness smoke must validate registry evidence instead of inferring safety from tool identity.

UPDATE tenant_platform_endpoint_tools
SET tags = CASE tool_key
  WHEN 'tenant_repo_conflict_intelligence_analyze' THEN 'repo_conflict_intelligence,tenant,read_only,request_only,no_provider_call,no_provider_write,no_git_mutation,no_secrets'
  WHEN 'tenant_repo_conflict_intelligence_plan' THEN 'repo_conflict_intelligence,tenant,planner,read_only,preview_only,request_only,no_provider_write,no_git_mutation,no_secrets'
  WHEN 'tenant_repo_conflict_intelligence_resolve_dry_run' THEN 'repo_conflict_intelligence,tenant,dry_run,read_only,preview_only,request_only,no_provider_write,no_git_mutation,no_secrets'
  ELSE tags
END
WHERE tool_key IN (
  'tenant_repo_conflict_intelligence_analyze',
  'tenant_repo_conflict_intelligence_plan',
  'tenant_repo_conflict_intelligence_resolve_dry_run'
);
