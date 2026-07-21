-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   Persist a read-only GitHub Actions workflow-runs listing endpoint in the
--   registry-driven GitHub REST dispatcher so PR verification can inspect CI
--   run state through endpoint authority instead of unsupported raw fallback
--   paths such as /actions/runs.
--
-- This migration registers metadata only. It never calls GitHub, reads credentials,
-- performs provider writes, or accepts caller-supplied HTTP methods or URLs.

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
  'ACT-GH-REST-043', 'github_api_mcp', 'github_list_workflow_runs_for_repo', 'listWorkflowRunsForRepo',
  'GitHub List Workflow Runs For Repository', 'https://api.github.com', 'github_rest', 'GET',
  '/repos/{owner}/{repo}/actions/runs', 'github_api_mcp',
  'listWorkflowRunsForRepo', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'GitHub Actions Workflow Runs Read',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'listWorkflowRunsForRepo',
    'summary', 'GitHub List Workflow Runs For Repository',
    'method', 'get',
    'path', '/repos/{owner}/{repo}/actions/runs',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','actor','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',100)),
      JSON_OBJECT('name','branch','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',255)),
      JSON_OBJECT('name','event','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',100)),
      JSON_OBJECT('name','status','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','enum',JSON_ARRAY('completed','action_required','cancelled','failure','neutral','skipped','stale','success','timed_out','in_progress','queued','requested','waiting','pending'))),
      JSON_OBJECT('name','conclusion','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','enum',JSON_ARRAY('success','failure','neutral','cancelled','skipped','timed_out','action_required'))),
      JSON_OBJECT('name','check_suite_id','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','created','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',120)),
      JSON_OBJECT('name','exclude_pull_requests','in','query','required',FALSE,'schema',JSON_OBJECT('type','boolean')),
      JSON_OBJECT('name','head_sha','in','query','required',FALSE,'schema',JSON_OBJECT('type','string','pattern','^[a-fA-F0-9]{40}$')),
      JSON_OBJECT('name','page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','per_page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1,'maximum',100))
    ),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE,'properties',JSON_OBJECT('total_count',JSON_OBJECT('type','integer'),'workflow_runs',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',TRUE))))))),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository not found or Actions disabled'),
      '422', JSON_OBJECT('description','Invalid filter request'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE', 'operations_log|approved_repository_metadata',
  'Canonical read-only GitHub Actions workflow-run listing endpoint. Method and path resolve only from endpoints authority.'
)
ON DUPLICATE KEY UPDATE
  parent_action_key = VALUES(parent_action_key),
  endpoint_operation = VALUES(endpoint_operation),
  endpoint_title = VALUES(endpoint_title),
  provider_domain = VALUES(provider_domain),
  provider_family = VALUES(provider_family),
  method = VALUES(method),
  endpoint_path_or_function = VALUES(endpoint_path_or_function),
  route_target = VALUES(route_target),
  openai_action_name = VALUES(openai_action_name),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  execution_layer = VALUES(execution_layer),
  dependencies = VALUES(dependencies),
  logging_target = VALUES(logging_target),
  status = VALUES(status),
  category_group = VALUES(category_group),
  category_detail = VALUES(category_detail),
  inventory_role = VALUES(inventory_role),
  inventory_source = VALUES(inventory_source),
  spec_validation_status = VALUES(spec_validation_status),
  auth_validation_status = VALUES(auth_validation_status),
  privacy_validation_status = VALUES(privacy_validation_status),
  execution_readiness = VALUES(execution_readiness),
  endpoint_role = VALUES(endpoint_role),
  execution_mode = VALUES(execution_mode),
  transport_required = VALUES(transport_required),
  transport_action_key = VALUES(transport_action_key),
  fallback_allowed = VALUES(fallback_allowed),
  schema_json = VALUES(schema_json),
  runtime_binding_profile = VALUES(runtime_binding_profile),
  admin_only = VALUES(admin_only),
  client_allowed = VALUES(client_allowed),
  team_allowed = VALUES(team_allowed),
  writeback_scope = VALUES(writeback_scope),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_ARRAY_APPEND(
      input_schema,
      '$.properties.tool_args.properties.endpoint_key.enum',
      'github_list_workflow_runs_for_repo'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(
        JSON_CONTAINS(
          JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'),
          JSON_QUOTE('github_list_workflow_runs_for_repo')
        ),
        0
      ) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      input_schema,
      '$.properties.tool_args.properties.query.properties.actor',
      JSON_OBJECT('type','string','minLength',1,'maxLength',100),
      '$.properties.tool_args.properties.query.properties.branch',
      JSON_OBJECT('type','string','minLength',1,'maxLength',255),
      '$.properties.tool_args.properties.query.properties.event',
      JSON_OBJECT('type','string','minLength',1,'maxLength',100),
      '$.properties.tool_args.properties.query.properties.status',
      JSON_OBJECT('type','string','enum',JSON_ARRAY('completed','action_required','cancelled','failure','neutral','skipped','stale','success','timed_out','in_progress','queued','requested','waiting','pending')),
      '$.properties.tool_args.properties.query.properties.conclusion',
      JSON_OBJECT('type','string','enum',JSON_ARRAY('success','failure','neutral','cancelled','skipped','timed_out','action_required')),
      '$.properties.tool_args.properties.query.properties.check_suite_id',
      JSON_OBJECT('type','integer','minimum',1),
      '$.properties.tool_args.properties.query.properties.created',
      JSON_OBJECT('type','string','minLength',1,'maxLength',120),
      '$.properties.tool_args.properties.query.properties.exclude_pull_requests',
      JSON_OBJECT('type','boolean'),
      '$.properties.tool_args.properties.query.properties.head_sha',
      JSON_OBJECT('type','string','pattern','^[a-fA-F0-9]{40}$')
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
    'source','1026_sprint69_github_actions_runs_read_dispatch',
    'reason','Expose read-only GitHub Actions workflow-run listing through SQL endpoint authority',
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
  'Read-only GitHub Actions workflow-run listing export for github_rest_endpoint_dispatch. Method/path/schema remain governed by endpoints authority.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'github_list_workflow_runs_for_repo'
  AND e.endpoint_id IS NOT NULL
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
  'ptdb_github_rest_dispatch_workflow_runs_list',
  'github_api_mcp',
  e.endpoint_key,
  e.id,
  CONCAT('github_api_mcp__', e.endpoint_key),
  'github_rest_endpoint_dispatch',
  'db_admin_tool',
  'admin',
  'github_actions_runs_read',
  'github_actions_workflow_runs_list',
  'runtime_endpoint_call',
  'github_actions_runs_list_readback_v1',
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
    'source','1026_sprint69_github_actions_runs_read_dispatch',
    'secrets_included',FALSE
  )
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key = 'github_list_workflow_runs_for_repo'
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
