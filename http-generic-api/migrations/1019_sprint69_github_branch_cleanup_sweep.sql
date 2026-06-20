-- Sprint 69: governed GitHub branch cleanup sweep.
-- Additive/idempotent registry and policy metadata only.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- destructive_operations=0
-- secrets_included=false

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
  'GitHub Branch Cleanup Sweep Contract',
  JSON_OBJECT(
    'rule', 'github_branch_cleanup_sweep_requires_fresh_plan_and_per_branch_guard',
    'tool_key', 'github_branch_cleanup_sweep',
    'resource_scope', 'repository',
    'actor_scope', 'admin_only',
    'dry_run_default', TRUE,
    'max_pages', 3,
    'scan_limit', 300,
    'max_deletes', 25,
    'min_age_days_default', 7,
    'allowed_branch_prefixes_are_fixed_subset', TRUE,
    'protected_branches_blocked', JSON_ARRAY('main','master','production','prod','staging','release'),
    'open_pull_requests_blocked', TRUE,
    'unique_commits_blocked', TRUE,
    'force_delete_allowed', FALSE,
    'apply_requires', JSON_ARRAY(
      'expected_base_sha',
      'expected_evidence_fingerprint',
      'typed_confirmation',
      'capability_envelope'
    ),
    'per_branch_revalidation', JSON_ARRAY(
      'actual_default_branch',
      'expected_head_sha',
      'open_pull_request_guard',
      'no_unique_commits',
      'pre_delete_sha_readback',
      'same_cycle_absence_readback'
    ),
    'failure_policy', JSON_OBJECT(
      'stop_on_first_failure', TRUE,
      'partial_success_reported', TRUE,
      'automatic_retry_after_unknown_transport_state', FALSE
    ),
    'secrets_included', FALSE
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,branch_cleanup,github_ref_delete,capability_envelope',
  'githubBranchCleanupSweep,githubRepositoryLifecycle,gptToolsRoutes,platform_tool_dispatch_bindings',
  'TRUE',
  'A bounded cleanup sweep may plan broadly, but apply is limited to 25 branches and must replay the same plan fingerprint before invoking the existing guarded single-branch deletion contract for each candidate.'
)
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_endpoint_tool_exports
  (export_key, parent_action_key, endpoint_key, tool_name, scope_class, tenant_id, status,
   source_endpoint_id, import_policy_json, input_schema_json, output_schema_json,
   auth_policy_json, execution_policy_json, notes)
SELECT
  CONCAT('github_api_mcp__', e.endpoint_key),
  e.parent_action_key,
  e.endpoint_key,
  CONCAT('github_api_mcp__', e.endpoint_key),
  'admin',
  NULL,
  'active',
  e.id,
  JSON_OBJECT('source', '1019_sprint69_github_branch_cleanup_sweep', 'preserve_endpoint_contract', TRUE),
  e.schema_json,
  NULL,
  JSON_OBJECT('admin_only', TRUE, 'credential_resolution', 'github_app_server_side'),
  JSON_OBJECT('dispatch_via', 'http_generic_api', 'provider_transport', 'github_app', 'secrets_included', FALSE),
  'Governed endpoint export required by the GitHub branch cleanup sweep.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.status = 'active'
  AND COALESCE(e.execution_readiness, 'ready') = 'ready'
  AND e.endpoint_key IN (
    'github_list_branches',
    'github_list_pull_requests',
    'github_compare_commits',
    'github_get_reference',
    'github_delete_reference'
  )
ON DUPLICATE KEY UPDATE
  source_endpoint_id = VALUES(source_endpoint_id),
  scope_class = VALUES(scope_class),
  status = VALUES(status),
  input_schema_json = COALESCE(VALUES(input_schema_json), input_schema_json),
  auth_policy_json = VALUES(auth_policy_json),
  execution_policy_json = VALUES(execution_policy_json),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_tool_dispatch_bindings
  (binding_id, parent_action_key, endpoint_key, source_endpoint_id, export_key, tool_key,
   surface_class, scope_class, capability_key, operation_intent, runtime_surface,
   readback_policy_key, partial_success_policy_key, atomicity_mode, status, metadata_json)
SELECT
  mapping.binding_id,
  'github_api_mcp',
  mapping.endpoint_key,
  e.id,
  CONCAT('github_api_mcp__', mapping.endpoint_key),
  'github_branch_cleanup_sweep',
  'virtual_admin_tool',
  'admin',
  'github_branch_delete',
  'github_branch_cleanup_sweep',
  'repository_ref_delete',
  'github_branch_cleanup_sweep_fingerprint_and_absence_v1',
  'github_branch_cleanup_sweep_partial_success_v1',
  'bounded_sequential',
  'active',
  mapping.metadata_json
FROM (
  SELECT 'ptdb_github_branch_cleanup_sweep_list_branches' AS binding_id,
         'github_list_branches' AS endpoint_key,
         JSON_OBJECT('role','candidate_scan','max_pages',3,'scan_limit',300,'secrets_included',FALSE) AS metadata_json
  UNION ALL
  SELECT 'ptdb_github_branch_cleanup_sweep_list_prs',
         'github_list_pull_requests',
         JSON_OBJECT('role','open_pr_exclusion','all_open_pages_required',TRUE,'secrets_included',FALSE)
  UNION ALL
  SELECT 'ptdb_github_branch_cleanup_sweep_compare',
         'github_compare_commits',
         JSON_OBJECT('role','unique_commit_guard','required_ahead_by',0,'allowed_status',JSON_ARRAY('behind','identical'),'secrets_included',FALSE)
  UNION ALL
  SELECT 'ptdb_github_branch_cleanup_sweep_get_ref',
         'github_get_reference',
         JSON_OBJECT('role','base_and_predelete_sha_readback','requires_expected_sha',TRUE,'secrets_included',FALSE)
  UNION ALL
  SELECT 'ptdb_github_branch_cleanup_sweep_delete_ref',
         'github_delete_reference',
         JSON_OBJECT('role','bounded_delete','max_deletes',25,'force_delete_allowed',FALSE,'same_cycle_absence_readback',TRUE,'secrets_included',FALSE)
) mapping
JOIN endpoints e
  ON e.parent_action_key = 'github_api_mcp'
 AND e.endpoint_key = mapping.endpoint_key
 AND e.status = 'active'
 AND COALESCE(e.execution_readiness, 'ready') = 'ready'
ON DUPLICATE KEY UPDATE
  source_endpoint_id = VALUES(source_endpoint_id),
  export_key = VALUES(export_key),
  scope_class = VALUES(scope_class),
  capability_key = VALUES(capability_key),
  operation_intent = VALUES(operation_intent),
  runtime_surface = VALUES(runtime_surface),
  readback_policy_key = VALUES(readback_policy_key),
  partial_success_policy_key = VALUES(partial_success_policy_key),
  atomicity_mode = VALUES(atomicity_mode),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry (
  certification_key,
  surface_key,
  surface_family,
  tool_or_action_key,
  risk_class,
  certification_status,
  smoke_strategy,
  dispatch_allowed,
  apply_allowed,
  requires_resource_authority,
  requires_dry_run,
  requires_audit_evidence,
  requires_readback,
  last_evidence_ref,
  last_certified_at,
  expires_at,
  notes
) VALUES (
  'github_branch_cleanup_sweep_v1',
  'github_repo_mutation_routes',
  'github',
  'github_branch_cleanup_sweep',
  'D',
  'guarded_sweep_contract_ci_certified',
  'dry_run_fingerprint_capability_typed_confirm_per_branch_delete_guard_absence_readback',
  1,
  0,
  1,
  1,
  1,
  1,
  'test-github-branch-cleanup-sweep.mjs;test-github-repository-lifecycle.mjs;test-safe-branch-cleanup-support.mjs',
  CURRENT_TIMESTAMP,
  NULL,
  'Dispatch is allowed for dry-run and capability-gated apply. Apply remains subject to fresh evidence and the existing single-branch deletion contract for every candidate.'
)
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  last_evidence_ref = VALUES(last_evidence_ref),
  last_certified_at = VALUES(last_certified_at),
  expires_at = VALUES(expires_at),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
