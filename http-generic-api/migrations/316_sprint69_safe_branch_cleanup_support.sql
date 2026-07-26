-- Sprint 69: Safe branch cleanup capability support.
-- Additive/idempotent governance repair only.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

-- Legacy membership backfill stored tenant_id as resource_ref. Add the canonical
-- workspace_id grant for every active membership without removing legacy rows.
INSERT INTO workspace_resource_grants (
  grant_id,
  tenant_id,
  grantee_user_id,
  resource_type,
  resource_ref,
  permission,
  status,
  source,
  granted_by,
  metadata_json
)
SELECT
  UUID(),
  w.tenant_id,
  m.user_id,
  'workspace',
  w.workspace_id,
  CASE
    WHEN LOWER(m.role) IN ('owner', 'admin') THEN 'admin'
    WHEN LOWER(m.role) IN ('editor', 'operator') THEN 'operate'
    ELSE 'view'
  END,
  'active',
  'workspace_registry_membership_backfill',
  NULL,
  JSON_OBJECT(
    'backfill', TRUE,
    'canonical_workspace_resource_ref', TRUE,
    'workspace_key', w.workspace_key,
    'membership_role', m.role,
    'secrets_included', FALSE
  )
FROM workspace_registry w
JOIN memberships m
  ON m.tenant_id = w.tenant_id
 AND m.status = 'active'
LEFT JOIN workspace_resource_grants g
  ON g.tenant_id = w.tenant_id
 AND g.grantee_user_id = m.user_id
 AND g.resource_type = 'workspace'
 AND g.resource_ref = w.workspace_id
 AND g.status = 'active'
WHERE w.bootstrap_status = 'ready'
  AND g.grant_id IS NULL
ON DUPLICATE KEY UPDATE
  permission = VALUES(permission),
  status = 'active',
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

-- Certification enables dispatch only after a capability envelope is approved.
-- apply_allowed remains false so approval cannot bypass runtime branch-content,
-- expected-SHA, open-PR, actual-default-branch, and same-cycle readback guards.
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
)
VALUES (
  'github_branch_delete_v1',
  'github_repo_mutation_routes',
  'github',
  'github_branch_delete',
  'D',
  'guarded_delete_contract_ci_certified',
  'actual_default_branch_expected_sha_open_pr_no_unique_commits_predelete_sha_absence_readback',
  1,
  0,
  1,
  1,
  1,
  1,
  'test-github-repository-lifecycle.mjs;test-safe-branch-cleanup-support.mjs',
  CURRENT_TIMESTAMP,
  NULL,
  'Dispatch is allowed only through an approved capability envelope. Runtime blocks default/protected branches, open PRs, SHA drift, and any branch with commits not present in the actual GitHub default branch.'
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

UPDATE platform_tool_dispatch_bindings
SET metadata_json = JSON_OBJECT(
      'requires_expected_head_sha', TRUE,
      'requires_typed_confirmation', TRUE,
      'blocks_open_pr', TRUE,
      'actual_default_branch_from_github', TRUE,
      'requires_no_unique_commits', TRUE,
      'requires_predelete_sha_readback', TRUE,
      'requires_same_cycle_absence_readback', TRUE,
      'secrets_included', FALSE
    ),
    readback_policy_key = 'github_branch_no_unique_commits_and_absence_same_cycle_v2',
    partial_success_policy_key = 'github_branch_delete_guarded_block_v2',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_branch_delete'
  AND status = 'active';

UPDATE admin_platform_endpoint_tools
SET description = 'Delete a governed disposable GitHub branch only after capability approval, actual GitHub default-branch protection, expected-head SHA match, open-PR guard, proof of zero unique commits, pre-delete SHA readback, and same-cycle absence readback.',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_branch_delete';
