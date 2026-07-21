-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   Persist GitHub Actions workflow-control endpoints in SQL authority after a
--   deep endpoint-registry scan confirmed that rerun and workflow_dispatch
--   surfaces were absent. This prevents future raw fallback attempts and makes
--   required provider operations explicit, reviewable, and schema-bound.
--
-- This migration registers metadata only. It never calls GitHub, reads credentials,
-- reruns a workflow, dispatches a workflow, or accepts caller-supplied raw methods
-- or URLs. Runtime use remains admin-only and governed by endpoint authority.

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
) VALUES
(
  'ACT-GH-REST-044', 'github_api_mcp', 'github_rerun_workflow_run', 'reRunWorkflow',
  'GitHub Rerun Workflow Run', 'https://api.github.com', 'github_rest', 'POST',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/rerun', 'github_api_mcp',
  'reRunWorkflow', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations',
  'GitHub Actions Workflow Control', 'endpoint_inventory', 'official_rest_candidate',
  'validated', 'validated', 'validated', 'ready', 'primary', 'http_delegated',
  'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId','reRunWorkflow',
    'summary','GitHub Rerun Workflow Run',
    'method','post',
    'path','/repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','run_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer','minimum',1))
    ),
    'responses',JSON_OBJECT(
      '201',JSON_OBJECT('description','Workflow rerun queued'),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow run not found'),
      '422',JSON_OBJECT('description','Workflow run cannot be rerun'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'FALSE',
  'operations_log|approved_repository_ci_control',
  'Admin-only GitHub Actions workflow rerun endpoint. Method and path resolve only from SQL endpoint authority.'
),
(
  'ACT-GH-REST-045', 'github_api_mcp', 'github_rerun_failed_jobs_for_workflow_run', 'reRunWorkflowFailedJobs',
  'GitHub Rerun Failed Jobs For Workflow Run', 'https://api.github.com', 'github_rest', 'POST',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', 'github_api_mcp',
  'reRunWorkflowFailedJobs', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations',
  'GitHub Actions Workflow Control', 'endpoint_inventory', 'official_rest_candidate',
  'validated', 'validated', 'validated', 'ready', 'primary', 'http_delegated',
  'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId','reRunWorkflowFailedJobs',
    'summary','GitHub Rerun Failed Jobs For Workflow Run',
    'method','post',
    'path','/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','run_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer','minimum',1))
    ),
    'responses',JSON_OBJECT(
      '201',JSON_OBJECT('description','Failed jobs rerun queued'),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow run not found'),
      '422',JSON_OBJECT('description','Failed jobs cannot be rerun'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'FALSE',
  'operations_log|approved_repository_ci_control',
  'Admin-only GitHub Actions failed-jobs rerun endpoint. Method and path resolve only from SQL endpoint authority.'
),
(
  'ACT-GH-REST-046', 'github_api_mcp', 'github_create_workflow_dispatch', 'createWorkflowDispatch',
  'GitHub Create Workflow Dispatch Event', 'https://api.github.com', 'github_rest', 'POST',
  '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', 'github_api_mcp',
  'createWorkflowDispatch', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations',
  'GitHub Actions Workflow Dispatch', 'endpoint_inventory', 'official_rest_candidate',
  'validated', 'validated', 'validated', 'ready', 'primary', 'http_delegated',
  'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId','createWorkflowDispatch',
    'summary','GitHub Create Workflow Dispatch Event',
    'method','post',
    'path','/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','workflow_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',191))
    ),
    'requestBody',JSON_OBJECT(
      'required',TRUE,
      'content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT(
        'type','object',
        'required',JSON_ARRAY('ref'),
        'additionalProperties',FALSE,
        'properties',JSON_OBJECT(
          'ref',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
          'inputs',JSON_OBJECT('type','object','additionalProperties',JSON_OBJECT('type',JSON_ARRAY('string','number','boolean')))
        )
      )))
    ),
    'responses',JSON_OBJECT(
      '204',JSON_OBJECT('description','Workflow dispatch accepted'),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow not found'),
      '422',JSON_OBJECT('description','Workflow dispatch request invalid'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'FALSE',
  'operations_log|approved_repository_ci_control',
  'Admin-only GitHub Actions workflow_dispatch endpoint. Method and path resolve only from SQL endpoint authority.'
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
SET input_schema = JSON_ARRAY_APPEND(input_schema, '$.properties.tool_args.properties.endpoint_key.enum', 'github_rerun_workflow_run'),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(JSON_CONTAINS(JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'), JSON_QUOTE('github_rerun_workflow_run')), 0) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_ARRAY_APPEND(input_schema, '$.properties.tool_args.properties.endpoint_key.enum', 'github_rerun_failed_jobs_for_workflow_run'),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(JSON_CONTAINS(JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'), JSON_QUOTE('github_rerun_failed_jobs_for_workflow_run')), 0) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_ARRAY_APPEND(input_schema, '$.properties.tool_args.properties.endpoint_key.enum', 'github_create_workflow_dispatch'),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_rest_endpoint_dispatch'
  AND JSON_VALID(input_schema) = 1
  AND COALESCE(JSON_CONTAINS(JSON_EXTRACT(input_schema, '$.properties.tool_args.properties.endpoint_key.enum'), JSON_QUOTE('github_create_workflow_dispatch')), 0) = 0;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      input_schema,
      '$.properties.tool_args.properties.path_params.properties.run_id', JSON_OBJECT('type','integer','minimum',1),
      '$.properties.tool_args.properties.path_params.properties.workflow_id', JSON_OBJECT('type','string','minLength',1,'maxLength',191),
      '$.properties.tool_args.properties.body.properties.ref', JSON_OBJECT('type','string','minLength',1,'maxLength',255),
      '$.properties.tool_args.properties.body.properties.inputs', JSON_OBJECT('type','object','additionalProperties',TRUE)
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
    'source','1038_sprint69_github_actions_workflow_control_dispatch',
    'reason','Expose GitHub Actions rerun and workflow_dispatch through SQL endpoint authority after deep missing-endpoint scan',
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
    'write_endpoint',TRUE
  ),
  JSON_OBJECT(
    'dispatch_via','runtime_endpoint_call',
    'transport_action_key','http_generic_api',
    'method_and_path_from_endpoints_only',TRUE,
    'mutation_preflight_required',TRUE,
    'same_cycle_readback_required',TRUE,
    'raw_fallback_forbidden',TRUE,
    'secrets_included',FALSE
  ),
  'Admin-only GitHub Actions workflow-control export for github_rest_endpoint_dispatch. Method/path/schema remain governed by endpoints authority.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key IN ('github_rerun_workflow_run','github_rerun_failed_jobs_for_workflow_run','github_create_workflow_dispatch')
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
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
  CONCAT('ptdb_github_rest_dispatch_', e.endpoint_key),
  e.parent_action_key,
  e.endpoint_key,
  e.id,
  CONCAT('github_api_mcp__', e.endpoint_key),
  'github_rest_endpoint_dispatch',
  'db_admin_tool',
  'admin',
  'github_actions_workflow_control',
  e.endpoint_key,
  'runtime_endpoint_call',
  'github_actions_workflow_control_readback_v1',
  'stop_on_first_unknown_mutation_outcome',
  'single',
  'active',
  JSON_OBJECT(
    'registry_driven',TRUE,
    'method_and_path_from_endpoints_only',TRUE,
    'provider_transport','http_generic_api',
    'admin_only',TRUE,
    'write_endpoint',TRUE,
    'requires_runtime_preflight',TRUE,
    'requires_same_cycle_readback',TRUE,
    'raw_fallback_forbidden',TRUE,
    'source','1038_sprint69_github_actions_workflow_control_dispatch',
    'secrets_included',FALSE
  )
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_key IN ('github_rerun_workflow_run','github_rerun_failed_jobs_for_workflow_run','github_create_workflow_dispatch')
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

INSERT INTO execution_policies (
  policy_group, policy_key, policy_value, active, execution_scope,
  affects_layer, blocking, notes
) VALUES (
  'Endpoint Registry Governance',
  'missing_endpoint_registry_first_policy_v1',
  JSON_OBJECT(
    'deep_scan_required', TRUE,
    'scan_surfaces', JSON_ARRAY('endpoints','admin_platform_endpoint_tools','platform_endpoint_tool_exports','platform_tool_dispatch_bindings','system_layer_tools','runtime_endpoint_call'),
    'if_endpoint_missing', 'add_registry_endpoint_to_database_before_runtime_use',
    'raw_url_fallback_allowed', FALSE,
    'raw_method_fallback_allowed', FALSE,
    'invent_endpoint_key_allowed', FALSE,
    'provider_call_before_registry_row_allowed', FALSE,
    'required_registry_fields', JSON_ARRAY('parent_action_key','endpoint_key','method','endpoint_path_or_function','schema_json','transport_action_key','execution_readiness'),
    'required_readback', JSON_ARRAY('endpoint_row','tool_export','dispatch_binding','schema_alignment','same_cycle_runtime_preflight'),
    'docs_required_for_write_endpoint', TRUE,
    'secrets_included', FALSE
  ),
  'TRUE',
  'github_api_mcp|runtime_endpoint_call|github_rest_endpoint_dispatch|endpoint_registry|admin_tools',
  'endpoints|admin_platform_endpoint_tools|platform_endpoint_tool_exports|platform_tool_dispatch_bindings|execution_policies',
  'TRUE',
  'When a needed provider endpoint is absent after a deep scan, register it in SQL authority first. Raw provider URL/method fallback is forbidden.'
)
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
