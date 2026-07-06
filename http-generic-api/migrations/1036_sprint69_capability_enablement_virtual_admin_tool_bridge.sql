-- 1036_sprint69_capability_enablement_virtual_admin_tool_bridge.sql
-- Purpose: bridge governed virtual admin repo patch tools into Capability Enablement Broker
-- without registering them as provider endpoint semantic capabilities.
-- Safety: additive/idempotent registry seed only; no provider call; no credential payload read;
-- no external write; no runtime execution; secrets_included=false.

INSERT INTO platform_tool_dispatch_bindings (
  binding_id,
  parent_action_key,
  endpoint_key,
  source_endpoint_id,
  export_key,
  tool_key,
  surface_class,
  scope_class,
  capability_key,
  operation_intent,
  runtime_surface,
  readback_policy_key,
  partial_success_policy_key,
  atomicity_mode,
  status,
  metadata_json
)
SELECT
  'ptdb_repo_patch_apply_put_contents',
  e.parent_action_key,
  e.endpoint_key,
  e.id,
  x.export_key,
  'repo_patch_apply',
  'virtual_admin_tool',
  'admin',
  'github_file_patch_apply',
  'github_repo_patch',
  'repo_patch_apply',
  'github_file_sha_readback_v1',
  'github_file_patch_no_partial_write_v1',
  'single_file_mutation',
  'active',
  JSON_OBJECT(
    'source','sprint69_capability_enablement_virtual_admin_tool_bridge',
    'delegates_to','repo_patch_apply',
    'supported_actions',JSON_ARRAY('write_file','replace_block','apply_unified_diff'),
    'requires_capability_envelope',true,
    'requires_same_cycle_readback',true,
    'secrets_included',false
  )
FROM endpoints e
JOIN platform_endpoint_tool_exports x
  ON x.parent_action_key = e.parent_action_key
 AND x.endpoint_key = e.endpoint_key
 AND x.status = 'active'
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'create_or_update_file_contents'
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
LIMIT 1
ON DUPLICATE KEY UPDATE
  source_endpoint_id = VALUES(source_endpoint_id),
  export_key = VALUES(export_key),
  tool_key = VALUES(tool_key),
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

INSERT INTO platform_tool_dispatch_bindings (
  binding_id,
  parent_action_key,
  endpoint_key,
  source_endpoint_id,
  export_key,
  tool_key,
  surface_class,
  scope_class,
  capability_key,
  operation_intent,
  runtime_surface,
  readback_policy_key,
  partial_success_policy_key,
  atomicity_mode,
  status,
  metadata_json
)
SELECT
  'ptdb_repo_patch_apply_delete_file',
  e.parent_action_key,
  e.endpoint_key,
  e.id,
  x.export_key,
  'repo_patch_apply',
  'virtual_admin_tool',
  'admin',
  'github_file_patch_apply',
  'github_repo_patch',
  'repo_patch_apply',
  'github_file_absence_readback_v1',
  'github_file_delete_no_partial_write_v1',
  'single_file_mutation',
  'active',
  JSON_OBJECT(
    'source','sprint69_capability_enablement_virtual_admin_tool_bridge',
    'delegates_to','repo_patch_apply',
    'supported_actions',JSON_ARRAY('delete_file'),
    'requires_capability_envelope',true,
    'requires_same_cycle_readback',true,
    'secrets_included',false
  )
FROM endpoints e
JOIN platform_endpoint_tool_exports x
  ON x.parent_action_key = e.parent_action_key
 AND x.endpoint_key = e.endpoint_key
 AND x.status = 'active'
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'github_delete_file'
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
LIMIT 1
ON DUPLICATE KEY UPDATE
  source_endpoint_id = VALUES(source_endpoint_id),
  export_key = VALUES(export_key),
  tool_key = VALUES(tool_key),
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
