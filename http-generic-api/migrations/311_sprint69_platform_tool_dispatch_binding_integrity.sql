-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: platform tool dispatch binding integrity and governed GitHub lifecycle closure.
-- This migration registers relationship metadata only. It performs no provider call,
-- reads no credential payload, performs no external send, and exposes no raw secrets.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE TABLE IF NOT EXISTS platform_tool_dispatch_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id VARCHAR(64) NOT NULL,
  parent_action_key VARCHAR(255) NOT NULL,
  endpoint_key VARCHAR(255) NOT NULL,
  source_endpoint_id BIGINT UNSIGNED NULL,
  export_key VARCHAR(255) NULL,
  tool_key VARCHAR(255) NOT NULL,
  surface_class VARCHAR(64) NOT NULL,
  scope_class VARCHAR(32) NOT NULL DEFAULT 'admin',
  capability_key VARCHAR(255) NULL,
  operation_intent VARCHAR(255) NOT NULL,
  runtime_surface VARCHAR(255) NOT NULL,
  readback_policy_key VARCHAR(255) NOT NULL,
  partial_success_policy_key VARCHAR(255) NULL,
  atomicity_mode VARCHAR(32) NOT NULL DEFAULT 'single',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_tool_dispatch_binding_id (binding_id),
  UNIQUE KEY uq_platform_tool_dispatch_relation (parent_action_key, endpoint_key, tool_key),
  KEY idx_platform_tool_dispatch_tool (tool_key, status),
  KEY idx_platform_tool_dispatch_endpoint (source_endpoint_id, status),
  KEY idx_platform_tool_dispatch_capability (capability_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  JSON_OBJECT('source', 'sprint69_platform_tool_dispatch_binding_integrity', 'preserve_endpoint_contract', TRUE),
  e.schema_json,
  NULL,
  JSON_OBJECT('admin_only', TRUE, 'credential_resolution', 'github_app_server_side'),
  JSON_OBJECT('dispatch_via', 'http_generic_api', 'provider_transport', 'github_app', 'secrets_included', FALSE),
  'Governed export required by the platform tool dispatch binding integrity relation.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.status = 'active'
  AND COALESCE(e.execution_readiness, 'ready') = 'ready'
  AND e.endpoint_key IN (
    'github_get_pull_request',
    'github_compare_commits',
    'github_list_pull_requests',
    'github_update_pull_request',
    'github_merge_pull_request',
    'github_update_pull_request_branch',
    'github_delete_reference',
    'github_get_reference',
    'github_create_branch_reference',
    'github_update_reference',
    'github_create_tree',
    'github_create_commit',
    'github_get_commit_object'
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
  mapping.tool_key,
  mapping.surface_class,
  'admin',
  mapping.capability_key,
  mapping.operation_intent,
  mapping.runtime_surface,
  mapping.readback_policy_key,
  mapping.partial_success_policy_key,
  mapping.atomicity_mode,
  'active',
  mapping.metadata_json
FROM (
  SELECT 'ptdb_github_pr_ci_gate_get_pr' AS binding_id,
         'github_get_pull_request' AS endpoint_key,
         'github_pr_ci_gate' AS tool_key,
         'virtual_admin_tool' AS surface_class,
         NULL AS capability_key,
         'github_pr_ci_readback' AS operation_intent,
         'github_pr_ci_gate' AS runtime_surface,
         'github_pr_head_compare_and_required_checks_v1' AS readback_policy_key,
         NULL AS partial_success_policy_key,
         'compound_read' AS atomicity_mode,
         JSON_OBJECT('dependencies', JSON_ARRAY('github_compare_commits', 'commit_check_runs'), 'secrets_included', FALSE) AS metadata_json
  UNION ALL
  SELECT 'ptdb_github_pr_finalize_get_pr', 'github_get_pull_request', 'github_pr_finalize',
         'virtual_admin_tool', 'github_pr_merge', 'github_pr_finalize',
         'github_pr_finalize', 'github_pr_ci_merge_ancestry_cleanup_v1',
         'github_pr_finalize_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('requires_expected_head_sha', TRUE, 'requires_expected_base_sha', TRUE, 'requires_typed_confirmation', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_github_pr_finalize_compare', 'github_compare_commits', 'github_pr_finalize',
         'virtual_admin_tool', 'github_pr_merge', 'github_pr_finalize',
         'github_pr_finalize', 'github_pr_ci_merge_ancestry_cleanup_v1',
         'github_pr_finalize_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('used_for', JSON_ARRAY('freshness_gate', 'merge_ancestry_readback'), 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_github_pr_finalize_merge', 'github_merge_pull_request', 'github_pr_finalize',
         'virtual_admin_tool', 'github_pr_merge', 'github_pr_finalize',
         'github_pr_finalize', 'github_pr_ci_merge_ancestry_cleanup_v1',
         'github_pr_finalize_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('merge_methods', JSON_ARRAY('merge', 'squash', 'rebase'), 'expected_head_sha_required', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_github_pr_finalize_get_ref', 'github_get_reference', 'github_pr_finalize',
         'virtual_admin_tool', 'github_pr_merge', 'github_pr_finalize',
         'github_pr_finalize', 'github_pr_ci_merge_ancestry_cleanup_v1',
         'github_pr_finalize_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('used_for', JSON_ARRAY('base_head_readback', 'branch_cleanup_guard'), 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_github_pr_finalize_delete_ref', 'github_delete_reference', 'github_pr_finalize',
         'virtual_admin_tool', 'github_pr_merge', 'github_pr_finalize',
         'github_pr_finalize', 'github_pr_ci_merge_ancestry_cleanup_v1',
         'github_pr_finalize_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('cleanup_after_ancestry_only', TRUE, 'requires_expected_head_sha', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_github_branch_delete', 'github_delete_reference', 'github_branch_delete',
         'virtual_admin_tool', 'github_branch_delete', 'github_repo_cleanup',
         'repository_ref_delete', 'github_branch_absence_same_cycle_v1',
         'github_branch_delete_partial_success_v1', 'transactional_guarded',
         JSON_OBJECT('requires_expected_head_sha', TRUE, 'requires_typed_confirmation', TRUE, 'blocks_open_pr', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_repo_batch_create_tree', 'github_create_tree', 'repo_patch_batch_apply',
         'virtual_admin_tool', 'github_file_patch_apply', 'github_repo_patch',
         'repository_change_set_apply', 'github_change_set_branch_head_v1',
         'github_change_set_no_partial_commit_v1', 'atomic_change_set',
         JSON_OBJECT('max_items', 50, 'expected_base_sha_required', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_repo_batch_create_commit', 'github_create_commit', 'repo_patch_batch_apply',
         'virtual_admin_tool', 'github_file_patch_apply', 'github_repo_patch',
         'repository_change_set_apply', 'github_change_set_branch_head_v1',
         'github_change_set_no_partial_commit_v1', 'atomic_change_set',
         JSON_OBJECT('dependency', 'github_create_tree', 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_repo_batch_create_ref', 'github_create_branch_reference', 'repo_patch_batch_apply',
         'virtual_admin_tool', 'github_file_patch_apply', 'github_repo_patch',
         'repository_change_set_apply', 'github_change_set_branch_head_v1',
         'github_change_set_no_partial_commit_v1', 'atomic_change_set',
         JSON_OBJECT('no_force', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_repo_batch_update_ref', 'github_update_reference', 'repo_patch_batch_apply',
         'virtual_admin_tool', 'github_file_patch_apply', 'github_repo_patch',
         'repository_change_set_apply', 'github_change_set_branch_head_v1',
         'github_change_set_no_partial_commit_v1', 'atomic_change_set',
         JSON_OBJECT('force', FALSE, 'expected_base_sha_required', TRUE, 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_admin_control_pr_update', 'github_update_pull_request', 'admin_control',
         'admin_cli_fallback', 'github_pr_update', 'github_pr_lifecycle',
         'admin_control_github_rest_fallback', 'github_pr_state_readback_v1',
         'github_pr_close_branch_cleanup_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('command', 'gh pr close', 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_admin_control_pr_merge', 'github_merge_pull_request', 'admin_control',
         'admin_cli_fallback', 'github_pr_merge', 'github_pr_lifecycle',
         'admin_control_github_rest_fallback', 'github_merge_ancestry_and_branch_cleanup_v1',
         'github_merge_branch_cleanup_partial_success_v1', 'compound_mutation',
         JSON_OBJECT('command', 'gh pr merge', 'secrets_included', FALSE)
  UNION ALL
  SELECT 'ptdb_admin_control_pr_update_branch', 'github_update_pull_request_branch', 'admin_control',
         'admin_cli_fallback', 'github_branch_update', 'github_pr_reconcile',
         'admin_control_github_rest_fallback', 'github_pr_update_branch_readback_v1',
         NULL, 'single',
         JSON_OBJECT('command', 'gh pr update-branch', 'secrets_included', FALSE)
) mapping
JOIN endpoints e
  ON e.parent_action_key = 'github_api_mcp'
 AND e.endpoint_key = mapping.endpoint_key
 AND e.status = 'active'
 AND COALESCE(e.execution_readiness, 'ready') = 'ready'
ON DUPLICATE KEY UPDATE
  source_endpoint_id = VALUES(source_endpoint_id),
  export_key = VALUES(export_key),
  surface_class = VALUES(surface_class),
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

CREATE OR REPLACE VIEW v_platform_tool_dispatch_integrity AS
SELECT
  e.id AS endpoint_id,
  e.parent_action_key,
  e.endpoint_key,
  e.method,
  e.endpoint_path_or_function,
  e.status AS endpoint_status,
  e.execution_readiness,
  x.export_key,
  x.tool_name AS exported_tool_name,
  x.scope_class AS export_scope_class,
  x.status AS export_status,
  b.binding_id,
  b.tool_key AS bound_tool_key,
  b.surface_class,
  b.capability_key,
  b.operation_intent,
  b.runtime_surface,
  b.readback_policy_key,
  b.partial_success_policy_key,
  b.atomicity_mode,
  b.status AS binding_status,
  apt.tool_key AS db_admin_tool_key,
  apt.is_enabled AS db_admin_tool_enabled,
  CASE WHEN x.export_key IS NULL OR x.status <> 'active' THEN 1 ELSE 0 END AS missing_active_export,
  CASE
    WHEN b.binding_id IS NULL THEN 1
    WHEN b.status <> 'active' THEN 1
    ELSE 0
  END AS missing_active_dispatch_binding,
  CASE
    WHEN UPPER(e.method) IN ('POST','PUT','PATCH','DELETE')
         AND b.binding_id IS NOT NULL
         AND (b.capability_key IS NULL OR b.capability_key = '')
    THEN 1 ELSE 0
  END AS mutation_missing_capability_key,
  CASE
    WHEN b.binding_id IS NOT NULL
         AND (b.readback_policy_key IS NULL OR b.readback_policy_key = '')
    THEN 1 ELSE 0
  END AS binding_missing_readback_policy
FROM endpoints e
LEFT JOIN platform_endpoint_tool_exports x
  ON x.source_endpoint_id = e.id
  OR (x.parent_action_key = e.parent_action_key AND x.endpoint_key = e.endpoint_key)
LEFT JOIN platform_tool_dispatch_bindings b
  ON b.parent_action_key = e.parent_action_key
 AND b.endpoint_key = e.endpoint_key
 AND b.status = 'active'
LEFT JOIN admin_platform_endpoint_tools apt
  ON apt.tool_key = COALESCE(b.tool_key, x.tool_name)
WHERE e.status = 'active'
  AND COALESCE(e.execution_readiness, 'ready') = 'ready';

INSERT INTO database_table_lifecycle_registry
  (table_name, table_family, owner_engine_key, owner_workflow_key, owner_action_key,
   authority_model, usage_status, write_strategy, retention_class, retention_days,
   archive_strategy, cleanup_strategy, growth_policy, linked_by_code, linked_by_policy,
   linked_by_foreign_key, risk_level, status, notes, last_checked_at)
VALUES
  ('platform_tool_dispatch_bindings', 'platform_governance', 'workflow_runtime_engine',
   'platform_tool_dispatch_integrity', 'github_api_mcp', 'registry_primary', 'active',
   'platform_primary', 'configuration_history', NULL, 'retain_active_and_archived_bindings',
   'archive_superseded_bindings_only_after_readback', 'bounded_by_endpoint_and_tool_catalog',
   1, 1, 0, 'high', 'active',
   'Canonical relationship between endpoint authority, exports, callable surfaces, capability policy, atomicity, and readback policy.', NOW())
ON DUPLICATE KEY UPDATE
  table_family = VALUES(table_family),
  owner_engine_key = VALUES(owner_engine_key),
  owner_workflow_key = VALUES(owner_workflow_key),
  owner_action_key = VALUES(owner_action_key),
  authority_model = VALUES(authority_model),
  usage_status = VALUES(usage_status),
  write_strategy = VALUES(write_strategy),
  retention_class = VALUES(retention_class),
  archive_strategy = VALUES(archive_strategy),
  cleanup_strategy = VALUES(cleanup_strategy),
  growth_policy = VALUES(growth_policy),
  linked_by_code = VALUES(linked_by_code),
  linked_by_policy = VALUES(linked_by_policy),
  risk_level = VALUES(risk_level),
  status = VALUES(status),
  notes = VALUES(notes),
  last_checked_at = VALUES(last_checked_at),
  updated_at = CURRENT_TIMESTAMP;
