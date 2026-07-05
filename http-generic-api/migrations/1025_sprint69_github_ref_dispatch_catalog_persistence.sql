-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   Persist GitHub direct reference read support in the registry-driven Admin tool catalog.
--   The canonical endpoint rows already own method, path, provider domain, auth, schema,
--   and transport. This migration exposes those existing read-only endpoints through
--   github_rest_endpoint_dispatch and binds them to dispatch-integrity metadata.
--
-- This migration registers metadata only. It never calls GitHub, reads credentials,
-- performs provider writes, or accepts caller-supplied HTTP methods or URLs.

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_ARRAY_APPEND(
      input_schema,
      '$.properties.tool_args.properties.endpoint_key.enum',
      'github_get_git_ref_head'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(
        JSON_CONTAINS(
          JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'),
          JSON_QUOTE('github_get_git_ref_head')
        ),
        0
      ) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_ARRAY_APPEND(
      input_schema,
      '$.properties.tool_args.properties.endpoint_key.enum',
      'github_get_reference'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(
        JSON_CONTAINS(
          JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'),
          JSON_QUOTE('github_get_reference')
        ),
        0
      ) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      input_schema,
      '$.properties.tool_args.properties.path_params.properties.branch',
      JSON_OBJECT('type','string','minLength',1,'maxLength',255,'pattern','^[A-Za-z0-9._/-]+$'),
      '$.properties.tool_args.properties.path_params.properties.ref',
      JSON_OBJECT('type','string','minLength',1,'maxLength',255,'pattern','^[A-Za-z0-9._/-]+$')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1;

INSERT INTO platform_endpoint_tool_exports (
  export_key, parent_action_key, endpoint_key, tool_name, scope_class, tenant_id,
  status, source_endpoint_id, import_policy_json, input_schema_json,
  output_schema_json, auth_policy_json, execution_policy_json, notes
)
SELECT
  CONCAT('github_api_mcp__', e.endpoint_key),
  e.parent_action_key,
  e.endpoint_key,
  'github_rest_endpoint_dispatch',
  'admin',
  NULL,
  'active',
  e.id,
  JSON_OBJECT(
    'source','1025_sprint69_github_ref_dispatch_catalog_persistence',
    'reason','Expose read-only Git reference endpoints already active in SQL endpoint authority',
    'preserve_endpoint_contract',TRUE,
    'canonical_rows_only',TRUE,
    'provider_call_during_registry_repair',FALSE,
    'external_write_during_registry_repair',FALSE,
    'secrets_included',FALSE
  ),
  e.schema_json,
  NULL,
  JSON_OBJECT(
    'admin_only',TRUE,
    'credential_resolution','github_app_server_side',
    'caller_supplied_authorization_forbidden',TRUE,
    'read_only_endpoint',TRUE
  ),
  JSON_OBJECT(
    'dispatch_via','runtime_endpoint_call',
    'transport_action_key','http_generic_api',
    'method_and_path_from_endpoints_only',TRUE,
    'mutation_preflight_required',FALSE,
    'same_cycle_readback_required',TRUE,
    'secrets_included',FALSE
  ),
  'Read-only Git reference endpoint export for github_rest_endpoint_dispatch. Method/path/schema remain governed by endpoints authority.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_id IS NOT NULL
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
  AND e.transport_action_key = 'http_generic_api'
  AND e.endpoint_key IN (
    'github_get_git_ref_head',
    'github_get_reference'
  )
ON DUPLICATE KEY UPDATE
  tool_name = VALUES(tool_name),
  scope_class = VALUES(scope_class),
  status = VALUES(status),
  source_endpoint_id = VALUES(source_endpoint_id),
  import_policy_json = VALUES(import_policy_json),
  input_schema_json = VALUES(input_schema_json),
  output_schema_json = VALUES(output_schema_json),
  auth_policy_json = VALUES(auth_policy_json),
  execution_policy_json = VALUES(execution_policy_json),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_tool_dispatch_bindings (
  binding_id, parent_action_key, endpoint_key, source_endpoint_id, export_key,
  tool_key, surface_class, scope_class, capability_key, operation_intent,
  runtime_surface, readback_policy_key, partial_success_policy_key,
  atomicity_mode, status, metadata_json
)
SELECT
  mapping.binding_id,
  'github_api_mcp',
  mapping.endpoint_key,
  e.id,
  CONCAT('github_api_mcp__', mapping.endpoint_key),
  'github_rest_endpoint_dispatch',
  'db_admin_tool',
  'admin',
  mapping.capability_key,
  mapping.operation_intent,
  'runtime_endpoint_call',
  mapping.readback_policy_key,
  NULL,
  'single',
  'active',
  JSON_OBJECT(
    'registry_driven',TRUE,
    'method_and_path_from_endpoints_only',TRUE,
    'provider_transport','http_generic_api',
    'admin_only',TRUE,
    'read_only_endpoint',TRUE,
    'requires_runtime_preflight',FALSE,
    'requires_same_cycle_readback',TRUE,
    'source','1025_sprint69_github_ref_dispatch_catalog_persistence',
    'secrets_included',FALSE
  )
FROM (
  SELECT 'ptdb_github_rest_dispatch_get_git_ref_head' AS binding_id,
         'github_get_git_ref_head' AS endpoint_key,
         'github_git_ref_read' AS capability_key,
         'github_git_ref_head_read' AS operation_intent,
         'github_git_ref_readback_v1' AS readback_policy_key
  UNION ALL
  SELECT 'ptdb_github_rest_dispatch_get_reference',
         'github_get_reference',
         'github_git_ref_read',
         'github_git_reference_read',
         'github_git_ref_readback_v1'
) mapping
JOIN endpoints e
  ON e.parent_action_key = 'github_api_mcp'
 AND e.endpoint_key = mapping.endpoint_key
 AND e.endpoint_id IS NOT NULL
 AND e.status = 'active'
 AND e.execution_readiness = 'ready'
 AND e.transport_action_key = 'http_generic_api'
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
