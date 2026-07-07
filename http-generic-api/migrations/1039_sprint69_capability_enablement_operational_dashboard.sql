-- 1039_sprint69_capability_enablement_operational_dashboard.sql
-- Purpose: expose no-secret operational dashboard/attention views for Capability Enablement Broker
-- and extend the guarded virtual admin tool bridge to superseded branch cleanup.
-- Safety: additive/idempotent registry and view changes only; no provider call; no credential read;
-- no external write; no runtime execution; secrets_included=false.

CREATE OR REPLACE VIEW v_capability_enablement_operational_dashboard AS
SELECT
  tenant_id,
  workspace_id,
  capability_key,
  operation_intent,
  COALESCE(runtime_surface, capability_key) AS runtime_surface,
  decision,
  next_allowed_mode,
  COUNT(*) AS request_count,
  SUM(CASE WHEN decision = 'ready_for_dispatch' THEN 1 ELSE 0 END) AS ready_for_dispatch_count,
  SUM(CASE WHEN decision = 'needs_approval' THEN 1 ELSE 0 END) AS needs_approval_count,
  SUM(CASE WHEN decision LIKE 'blocked%' THEN 1 ELSE 0 END) AS blocked_count,
  SUM(CASE WHEN JSON_SEARCH(COALESCE(reason_codes_json, JSON_ARRAY()), 'one', 'ENVELOPE_EXPIRED') IS NOT NULL THEN 1 ELSE 0 END) AS expired_envelope_count,
  SUM(CASE WHEN provider_calls_made <> 0 THEN 1 ELSE 0 END) AS provider_call_rows,
  SUM(CASE WHEN external_mutations_executed <> 0 THEN 1 ELSE 0 END) AS external_mutation_rows,
  SUM(CASE WHEN secrets_included <> 0 THEN 1 ELSE 0 END) AS safety_redaction_rows,
  MAX(created_at) AS latest_created_at
FROM capability_enablement_requests
GROUP BY tenant_id, workspace_id, capability_key, operation_intent, COALESCE(runtime_surface, capability_key), decision, next_allowed_mode;

CREATE OR REPLACE VIEW v_capability_enablement_operational_attention AS
SELECT
  request_id,
  tenant_id,
  user_id,
  workspace_id,
  capability_key,
  operation_intent,
  app_key,
  COALESCE(runtime_surface, capability_key) AS runtime_surface,
  decision,
  next_allowed_mode,
  JSON_UNQUOTE(JSON_EXTRACT(COALESCE(reason_codes_json, JSON_ARRAY(decision)), '$[0]')) AS reason_code,
  CASE
    WHEN decision = 'blocked_secret_boundary' THEN 'critical'
    WHEN decision LIKE 'blocked%' THEN 'high'
    WHEN decision = 'degraded_contract' THEN 'high'
    WHEN decision IN ('needs_approval','needs_resource_binding','needs_credential','needs_certification','needs_execution_enablement') THEN 'medium'
    ELSE 'info'
  END AS severity,
  CASE
    WHEN decision = 'needs_approval' THEN 'capability.approve_envelope'
    WHEN decision = 'blocked_secret_boundary' THEN 'capability.remove_secret_like_input'
    WHEN decision LIKE 'blocked%' THEN 'capability.review_policy_block'
    ELSE 'capability.resolve_gap'
  END AS recommended_action_key,
  provider_calls_made,
  external_mutations_executed,
  secrets_included,
  created_at,
  expires_at
FROM capability_enablement_requests
WHERE decision NOT IN ('ready_for_dispatch','ready_for_preview')
   OR provider_calls_made <> 0
   OR external_mutations_executed <> 0
   OR secrets_included <> 0;

INSERT INTO platform_tool_dispatch_bindings (
  binding_id, parent_action_key, endpoint_key, source_endpoint_id, export_key, tool_key,
  surface_class, scope_class, capability_key, operation_intent, runtime_surface,
  readback_policy_key, partial_success_policy_key, atomicity_mode, status, metadata_json
)
SELECT
  CONCAT('ptdb_github_superseded_branch_cleanup_', e.endpoint_key),
  e.parent_action_key,
  e.endpoint_key,
  e.id,
  x.export_key,
  'github_superseded_branch_cleanup',
  'virtual_admin_tool',
  'admin',
  'github_branch_cleanup',
  'github_superseded_branch_cleanup',
  'github_superseded_branch_cleanup',
  'github_superseded_branch_absence_readback_v1',
  'github_superseded_branch_cleanup_no_partial_delete_v1',
  'single_ref_mutation',
  'active',
  JSON_OBJECT(
    'source','sprint69_capability_enablement_operational_dashboard',
    'delegates_to','github_superseded_branch_cleanup',
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
  AND e.endpoint_key IN ('github_get_reference','github_compare_commits','github_delete_reference')
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
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
