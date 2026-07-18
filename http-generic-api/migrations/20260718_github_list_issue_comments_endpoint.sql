-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Registers the read-only GitHub issue/PR conversation-comments endpoint and
-- its governed Admin dispatcher export/binding. No provider call occurs here.

INSERT INTO endpoints (
  endpoint_id, parent_action_key, endpoint_key, endpoint_operation, endpoint_title,
  provider_domain, provider_family, method, endpoint_path_or_function,
  route_target, openai_action_name, module_binding, connector_family,
  execution_layer, dependencies, logging_target, status,
  category_group, category_detail, inventory_role, inventory_source,
  spec_validation_status, auth_validation_status, privacy_validation_status,
  execution_readiness, endpoint_role, execution_mode, transport_required,
  transport_action_key, fallback_allowed, schema_json, runtime_binding_profile,
  admin_only, client_allowed, team_allowed, writeback_scope, notes
) VALUES (
  'ACT-GH-REST-047', 'github_api_mcp', 'github_list_issue_comments', 'listIssueComments',
  'GitHub List Issue Comments', 'https://api.github.com', 'github_rest', 'GET',
  '/repos/{owner}/{repo}/issues/{issue_number}/comments', 'github_api_mcp',
  'listIssueComments', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations',
  'Issue and Pull Request Comments Read', 'endpoint_inventory', 'official_rest_candidate',
  'validated', 'validated', 'validated', 'ready', 'primary', 'http_delegated',
  'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'listIssueComments',
    'summary', 'GitHub List Issue Comments',
    'method', 'get',
    'path', '/repos/{owner}/{repo}/issues/{issue_number}/comments',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','issue_number','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','since','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','format','date-time')),
      JSON_OBJECT('name','page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','per_page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1,'maximum',100))
    ),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',TRUE))))),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository or issue not found'),
      '422', JSON_OBJECT('description','Validation failed or request was spammed'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE',
  'operations_log|approved_repository_metadata',
  'Canonical read-only GitHub issue and pull-request conversation-comments endpoint. Pull-request review comments are a separate resource.'
)
ON DUPLICATE KEY UPDATE
  endpoint_operation=VALUES(endpoint_operation), endpoint_title=VALUES(endpoint_title),
  provider_domain=VALUES(provider_domain), provider_family=VALUES(provider_family),
  method=VALUES(method), endpoint_path_or_function=VALUES(endpoint_path_or_function),
  route_target=VALUES(route_target), openai_action_name=VALUES(openai_action_name),
  module_binding=VALUES(module_binding), connector_family=VALUES(connector_family),
  execution_layer=VALUES(execution_layer), dependencies=VALUES(dependencies),
  logging_target=VALUES(logging_target), status=VALUES(status),
  category_group=VALUES(category_group), category_detail=VALUES(category_detail),
  inventory_role=VALUES(inventory_role), inventory_source=VALUES(inventory_source),
  spec_validation_status=VALUES(spec_validation_status), auth_validation_status=VALUES(auth_validation_status),
  privacy_validation_status=VALUES(privacy_validation_status), execution_readiness=VALUES(execution_readiness),
  endpoint_role=VALUES(endpoint_role), execution_mode=VALUES(execution_mode),
  transport_required=VALUES(transport_required), transport_action_key=VALUES(transport_action_key),
  fallback_allowed=VALUES(fallback_allowed), schema_json=VALUES(schema_json),
  runtime_binding_profile=VALUES(runtime_binding_profile), admin_only=VALUES(admin_only),
  client_allowed=VALUES(client_allowed), team_allowed=VALUES(team_allowed),
  writeback_scope=VALUES(writeback_scope), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_SEARCH(input_schema,'one','github_list_issue_comments',NULL,'$.properties.tool_args.properties.endpoint_key.enum[*]') IS NULL
        THEN JSON_ARRAY_APPEND(input_schema,'$.properties.tool_args.properties.endpoint_key.enum','github_list_issue_comments')
        ELSE input_schema
      END,
      '$.properties.tool_args.properties.query.properties.since',
      JSON_OBJECT('type','string','format','date-time')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key='github_rest_endpoint_dispatch' AND is_enabled=1;

INSERT INTO platform_endpoint_tool_exports (
  export_key, parent_action_key, endpoint_key, tool_name, scope_class, tenant_id,
  status, source_endpoint_id, import_policy_json, input_schema_json,
  output_schema_json, auth_policy_json, execution_policy_json, notes
)
SELECT
  CONCAT('github_api_mcp__',e.endpoint_key), e.parent_action_key, e.endpoint_key,
  'github_rest_endpoint_dispatch','admin',NULL,'active',e.id,
  JSON_OBJECT('source','20260718_github_list_issue_comments_endpoint','preserve_endpoint_contract',TRUE,'canonical_rows_only',TRUE),
  e.schema_json,NULL,
  JSON_OBJECT('admin_only',TRUE,'credential_resolution','github_app_server_side','caller_supplied_authorization_forbidden',TRUE),
  JSON_OBJECT('dispatch_via','runtime_endpoint_call','transport_action_key','http_generic_api','method_and_path_from_endpoints_only',TRUE,'read_only',TRUE,'same_cycle_readback_required',TRUE,'secrets_included',FALSE),
  'Registry-driven GitHub issue and pull-request conversation-comments read export.'
FROM endpoints e
WHERE e.parent_action_key='github_api_mcp' AND e.endpoint_key='github_list_issue_comments'
  AND e.endpoint_id='ACT-GH-REST-047' AND e.status='active'
  AND e.execution_readiness='ready' AND e.transport_action_key='http_generic_api'
ON DUPLICATE KEY UPDATE
  tool_name=VALUES(tool_name), scope_class=VALUES(scope_class), status=VALUES(status),
  source_endpoint_id=VALUES(source_endpoint_id), import_policy_json=VALUES(import_policy_json),
  input_schema_json=VALUES(input_schema_json), auth_policy_json=VALUES(auth_policy_json),
  execution_policy_json=VALUES(execution_policy_json), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_tool_dispatch_bindings (
  binding_id, parent_action_key, endpoint_key, source_endpoint_id, export_key,
  tool_key, surface_class, scope_class, capability_key, operation_intent,
  runtime_surface, readback_policy_key, partial_success_policy_key,
  atomicity_mode, status, metadata_json
)
SELECT
  'ptdb_github_rest_dispatch_issue_comments_list', e.parent_action_key, e.endpoint_key,
  e.id, CONCAT('github_api_mcp__',e.endpoint_key), 'github_rest_endpoint_dispatch',
  'db_admin_tool','admin','github_issue_comments_read','github_issue_comments_read',
  'runtime_endpoint_call','github_issue_comments_list_readback_v1',NULL,'single','active',
  JSON_OBJECT('registry_driven',TRUE,'method_and_path_from_endpoints_only',TRUE,'provider_transport','http_generic_api','admin_only',TRUE,'read_only',TRUE,'requires_runtime_preflight',FALSE,'requires_same_cycle_readback',TRUE,'secrets_included',FALSE)
FROM endpoints e
WHERE e.parent_action_key='github_api_mcp' AND e.endpoint_key='github_list_issue_comments'
  AND e.endpoint_id='ACT-GH-REST-047' AND e.status='active'
  AND e.execution_readiness='ready' AND e.transport_action_key='http_generic_api'
ON DUPLICATE KEY UPDATE
  source_endpoint_id=VALUES(source_endpoint_id), export_key=VALUES(export_key),
  surface_class=VALUES(surface_class), scope_class=VALUES(scope_class),
  capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent),
  runtime_surface=VALUES(runtime_surface), readback_policy_key=VALUES(readback_policy_key),
  partial_success_policy_key=VALUES(partial_success_policy_key), atomicity_mode=VALUES(atomicity_mode),
  status=VALUES(status), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;
