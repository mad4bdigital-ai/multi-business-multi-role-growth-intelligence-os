-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Purpose:
--   1. Reconcile the existing active/ready github_create_issue_comment endpoint with
--      the canonical GitHub 201 Created response contract already present in
--      schemas/github/github_rest.yaml.
--   2. Export that reviewed endpoint through the existing admin-only
--      github_rest_endpoint_dispatch surface instead of requiring a direct
--      runtime_endpoint_call escape hatch.
--   3. Preserve runtime preflight, approval, audit, and same-cycle readback
--      requirements for the mutation.
--
-- This migration changes registry metadata only. It performs no GitHub call,
-- credential read, provider write, automatic retry, or secret-backed operation.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.201',
      JSON_OBJECT(
        'description', 'Created',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_create_issue_comment'
  AND method = 'POST'
  AND endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
  AND status = 'active'
  AND execution_readiness = 'ready'
  AND transport_action_key = 'http_generic_api';

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_SEARCH(
          input_schema,
          'one',
          'github_create_issue_comment',
          NULL,
          '$.properties.tool_args.properties.endpoint_key.enum[*]'
        ) IS NULL
        THEN JSON_ARRAY_APPEND(
          input_schema,
          '$.properties.tool_args.properties.endpoint_key.enum',
          'github_create_issue_comment'
        )
        ELSE input_schema
      END,
      '$.properties.tool_args.properties.body.properties.body',
      JSON_OBJECT('type','string','minLength',1,'maxLength',65536)
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND is_enabled = 1;

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
    'source', '20260808_github_issue_comment_dispatch_parity',
    'preserve_endpoint_contract', TRUE,
    'canonical_rows_only', TRUE
  ),
  e.schema_json,
  NULL,
  JSON_OBJECT(
    'admin_only', TRUE,
    'credential_resolution', 'github_app_server_side',
    'caller_supplied_authorization_forbidden', TRUE
  ),
  JSON_OBJECT(
    'dispatch_via', 'runtime_endpoint_call',
    'transport_action_key', 'http_generic_api',
    'method_and_path_from_endpoints_only', TRUE,
    'read_only', FALSE,
    'mutation', TRUE,
    'preflight_required', TRUE,
    'approval_required', TRUE,
    'same_cycle_readback_required', TRUE,
    'secrets_included', FALSE
  ),
  'Registry-driven GitHub issue-comment create export. Mutation remains behind runtime preflight, approval, audit, and same-cycle readback gates.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'github_create_issue_comment'
  AND e.method = 'POST'
  AND e.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
  AND e.transport_action_key = 'http_generic_api'
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
  'ptdb_github_rest_dispatch_issue_comment_create',
  e.parent_action_key,
  e.endpoint_key,
  e.id,
  export_row.export_key,
  'github_rest_endpoint_dispatch',
  'db_admin_tool',
  'admin',
  'github_issue_comments_write',
  'github_issue_comment_create',
  'runtime_endpoint_call',
  'github_issue_comment_exact_readback_v1',
  NULL,
  'single',
  'active',
  JSON_OBJECT(
    'registry_driven', TRUE,
    'method_and_path_from_endpoints_only', TRUE,
    'provider_transport', 'http_generic_api',
    'admin_only', TRUE,
    'read_only', FALSE,
    'mutation', TRUE,
    'requires_runtime_preflight', TRUE,
    'requires_approval', TRUE,
    'requires_same_cycle_readback', TRUE,
    'secrets_included', FALSE
  )
FROM endpoints e
JOIN platform_endpoint_tool_exports export_row
  ON export_row.source_endpoint_id = e.id
 AND export_row.export_key = CONCAT('github_api_mcp__', e.endpoint_key)
 AND export_row.tool_name = 'github_rest_endpoint_dispatch'
 AND export_row.status = 'active'
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'github_create_issue_comment'
  AND e.method = 'POST'
  AND e.endpoint_path_or_function = '/repos/{owner}/{repo}/issues/{issue_number}/comments'
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
