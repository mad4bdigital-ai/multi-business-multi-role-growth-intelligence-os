-- Repository Conflict Intelligence Phase 2 tool registry extension.
-- Adds resolver dry-run, PR automation preview, case-study readback, and tenant dry-run.
-- No provider write, Git mutation, merge, deploy, credential read, or secret response.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'repo_conflict_intelligence_resolve_dry_run',
    'Repository Conflict Resolver Dry Run',
    'Build typed conflict-resolution operations with execution disabled. No Git mutation or provider write.',
    'POST',
    '/admin/repo-conflict-intelligence/resolve-dry-run',
    JSON_ARRAY(),
    JSON_OBJECT('type','object','properties',JSON_OBJECT('analysis',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array'),'commits',JSON_OBJECT('type','array'),'compare',JSON_OBJECT('type','object')),'additionalProperties',true),
    NULL,
    'repo_conflict_intelligence,admin,dry_run,no_provider_write,no_git_mutation,no_secrets,capability_planning',
    1,
    6653
  ),
  (
    'repo_conflict_intelligence_pr_automation_preview',
    'Repository Conflict PR Automation Preview',
    'Build a bounded advisory-comment plan and Markdown preview. Does not post to GitHub.',
    'POST',
    '/admin/repo-conflict-intelligence/pr-automation-preview',
    JSON_ARRAY(),
    JSON_OBJECT('type','object','properties',JSON_OBJECT('pull_number',JSON_OBJECT('type','integer','minimum',1),'analysis',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array'),'commits',JSON_OBJECT('type','array'),'compare',JSON_OBJECT('type','object')),'additionalProperties',true),
    NULL,
    'repo_conflict_intelligence,admin,automation_preview,comment_plan,no_provider_write,no_secrets,approval_required',
    1,
    6654
  ),
  (
    'repo_conflict_intelligence_case_study_get',
    'Get Repository Conflict Case Study',
    'Return a bounded built-in case study with analysis plan dry-run and comment preview.',
    'GET',
    '/admin/repo-conflict-intelligence/case-studies/{caseKey}',
    JSON_ARRAY('caseKey'),
    JSON_OBJECT('type','object','required',JSON_ARRAY('caseKey'),'properties',JSON_OBJECT('caseKey',JSON_OBJECT('type','string','enum',JSON_ARRAY('pr_2474_generated_docs_conflict'))),'additionalProperties',false),
    NULL,
    'repo_conflict_intelligence,admin,case_study,read_only,no_secrets',
    1,
    6655
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method), http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema), fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);

INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'tenant_repo_conflict_intelligence_resolve_dry_run',
    'Tenant Repository Conflict Resolver Dry Run',
    'Return a tenant-safe dry-run with execution disabled and ADMIN resolution as the only mutation path.',
    'POST',
    '/me/repo-conflict-intelligence/resolve-dry-run',
    JSON_ARRAY(),
    JSON_OBJECT('type','object','properties',JSON_OBJECT('analysis',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array'),'commits',JSON_OBJECT('type','array'),'compare',JSON_OBJECT('type','object')),'additionalProperties',true),
    NULL,
    'repo_conflict_intelligence,tenant,dry_run,request_only,no_provider_write,no_git_mutation,no_secrets',
    1,
    6652
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method), http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema), fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);
