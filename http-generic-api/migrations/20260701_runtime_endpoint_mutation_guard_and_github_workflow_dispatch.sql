-- Runtime endpoint mutation guard and governed GitHub workflow dispatch metadata.
-- Additive registry and policy changes only; this migration performs no provider call.
-- no_provider_call
-- no_external_write
-- no_credential_payload_read
-- no_raw_secrets
-- secrets_included=false

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
  'ACT-GH-REST-042', 'github_api_mcp', 'github_dispatch_workflow', 'createWorkflowDispatch',
  'GitHub Dispatch Workflow', 'https://api.github.com', 'github_rest', 'POST',
  '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', 'github_api_mcp',
  'createWorkflowDispatch', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Workflow Dispatch',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId','createWorkflowDispatch',
    'summary','GitHub Dispatch Workflow',
    'method','post',
    'path','/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','workflow_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',255))
    ),
    'requestBody',JSON_OBJECT('required',TRUE,'content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT(
      'type','object','required',JSON_ARRAY('ref'),'properties',JSON_OBJECT(
        'ref',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
        'inputs',JSON_OBJECT('type','object','additionalProperties',JSON_OBJECT('type','string'),'maxProperties',50)
      ),'additionalProperties',FALSE
    )))),
    'responses',JSON_OBJECT(
      '204',JSON_OBJECT('description','Workflow dispatch accepted'),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization or workflow permission failed'),
      '404',JSON_OBJECT('description','Repository or workflow not found'),
      '422',JSON_OBJECT('description','Invalid ref or workflow inputs'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE',
  'operations_log|workflow_dispatch_readback',
  'Mutation endpoint. Requires same-cycle passive preview, capability envelope, typed confirmation, explicit live approval, and workflow-run readback.'
),
(
  'ACT-GH-REST-043', 'github_api_mcp', 'github_list_workflow_runs', 'listWorkflowRunsForWorkflow',
  'GitHub List Workflow Runs', 'https://api.github.com', 'github_rest', 'GET',
  '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', 'github_api_mcp',
  'listWorkflowRunsForWorkflow', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Workflow Run Readback',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId','listWorkflowRunsForWorkflow',
    'summary','GitHub List Workflow Runs',
    'method','get',
    'path','/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','workflow_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',255)),
      JSON_OBJECT('name','actor','in','query','required',FALSE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','branch','in','query','required',FALSE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','event','in','query','required',FALSE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','status','in','query','required',FALSE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','per_page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1,'maximum',100))
    ),
    'responses',JSON_OBJECT(
      '200',JSON_OBJECT('description','Workflow runs returned','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT(
        'type','object','required',JSON_ARRAY('total_count','workflow_runs'),'properties',JSON_OBJECT(
          'total_count',JSON_OBJECT('type','integer'),
          'workflow_runs',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',TRUE))
        ),'additionalProperties',TRUE
      )))),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow not found'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE',
  'operations_log|workflow_dispatch_readback',
  'Read-only endpoint used to verify a workflow_dispatch run after GitHub returns 204.'
)
ON DUPLICATE KEY UPDATE
  parent_action_key=VALUES(parent_action_key),endpoint_key=VALUES(endpoint_key),endpoint_operation=VALUES(endpoint_operation),
  endpoint_title=VALUES(endpoint_title),provider_domain=VALUES(provider_domain),provider_family=VALUES(provider_family),
  method=VALUES(method),endpoint_path_or_function=VALUES(endpoint_path_or_function),route_target=VALUES(route_target),
  openai_action_name=VALUES(openai_action_name),module_binding=VALUES(module_binding),connector_family=VALUES(connector_family),
  execution_layer=VALUES(execution_layer),dependencies=VALUES(dependencies),logging_target=VALUES(logging_target),
  status=VALUES(status),category_group=VALUES(category_group),category_detail=VALUES(category_detail),
  inventory_role=VALUES(inventory_role),inventory_source=VALUES(inventory_source),
  spec_validation_status=VALUES(spec_validation_status),auth_validation_status=VALUES(auth_validation_status),
  privacy_validation_status=VALUES(privacy_validation_status),execution_readiness=VALUES(execution_readiness),
  endpoint_role=VALUES(endpoint_role),execution_mode=VALUES(execution_mode),transport_required=VALUES(transport_required),
  transport_action_key=VALUES(transport_action_key),fallback_allowed=VALUES(fallback_allowed),schema_json=VALUES(schema_json),
  runtime_binding_profile=VALUES(runtime_binding_profile),admin_only=VALUES(admin_only),client_allowed=VALUES(client_allowed),
  team_allowed=VALUES(team_allowed),writeback_scope=VALUES(writeback_scope),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
SET input_schema=JSON_SET(
      input_schema,
      '$.properties.tool_args.properties.endpoint_key.enum',JSON_ARRAY(
        'github_update_pull_request','github_list_issue_labels','github_add_issue_labels',
        'github_set_issue_labels','github_remove_issue_label','github_dispatch_workflow','github_list_workflow_runs'
      ),
      '$.properties.tool_args.properties.path_params.properties.workflow_id',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
      '$.properties.tool_args.properties.query.properties.actor',JSON_OBJECT('type','string'),
      '$.properties.tool_args.properties.query.properties.branch',JSON_OBJECT('type','string'),
      '$.properties.tool_args.properties.query.properties.event',JSON_OBJECT('type','string'),
      '$.properties.tool_args.properties.query.properties.status',JSON_OBJECT('type','string'),
      '$.properties.tool_args.properties.body.properties.ref',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
      '$.properties.tool_args.properties.body.properties.inputs',JSON_OBJECT('type','object','additionalProperties',JSON_OBJECT('type','string'),'maxProperties',50)
    ),
    description='Admin-only registry-driven GitHub REST dispatcher with fail-closed mutation preflight, capability-envelope approval, and concrete readback evidence.',
    tags='github,rest,registry_driven,admin_only,endpoint_authority,http_generic_api,mutation_guarded,typed_confirmation,readback,no_raw_method,no_raw_url,no_secrets',
    updated_at=CURRENT_TIMESTAMP
WHERE tool_key='github_rest_endpoint_dispatch';

INSERT INTO platform_endpoint_tool_exports (
  export_key,parent_action_key,endpoint_key,tool_name,scope_class,tenant_id,status,source_endpoint_id,
  import_policy_json,input_schema_json,output_schema_json,auth_policy_json,execution_policy_json,notes
)
SELECT CONCAT('github_api_mcp__',e.endpoint_key),e.parent_action_key,e.endpoint_key,'github_rest_endpoint_dispatch',
       'admin',NULL,'active',e.id,
       JSON_OBJECT('source','20260701_runtime_endpoint_mutation_guard_and_github_workflow_dispatch','preserve_endpoint_contract',TRUE,'canonical_rows_only',TRUE),
       e.schema_json,NULL,
       JSON_OBJECT('admin_only',TRUE,'credential_resolution','github_app_server_side','caller_supplied_authorization_forbidden',TRUE),
       JSON_OBJECT(
         'dispatch_via','runtime_endpoint_call','transport_action_key','http_generic_api',
         'method_and_path_from_endpoints_only',TRUE,'mutation_preflight_required',IF(e.method='POST',TRUE,FALSE),
         'capability_envelope_required',IF(e.method='POST',TRUE,FALSE),
         'typed_confirmation_required',IF(e.method='POST','EXECUTE_RUNTIME_ENDPOINT_GITHUB_DISPATCH_WORKFLOW',NULL),
         'same_cycle_readback_required',TRUE,'secrets_included',FALSE
       ),
       'Registry-driven GitHub workflow endpoint export; method, path, auth, and schema remain SQL-authoritative.'
FROM endpoints e
WHERE e.parent_action_key='github_api_mcp'
  AND e.endpoint_key IN ('github_dispatch_workflow','github_list_workflow_runs')
  AND e.status='active' AND e.execution_readiness='ready' AND e.transport_action_key='http_generic_api'
ON DUPLICATE KEY UPDATE
  parent_action_key=VALUES(parent_action_key),endpoint_key=VALUES(endpoint_key),tool_name=VALUES(tool_name),
  scope_class=VALUES(scope_class),status=VALUES(status),source_endpoint_id=VALUES(source_endpoint_id),
  import_policy_json=VALUES(import_policy_json),input_schema_json=VALUES(input_schema_json),
  output_schema_json=VALUES(output_schema_json),auth_policy_json=VALUES(auth_policy_json),
  execution_policy_json=VALUES(execution_policy_json),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_tool_dispatch_bindings (
  binding_id,parent_action_key,endpoint_key,source_endpoint_id,export_key,tool_key,surface_class,scope_class,
  capability_key,operation_intent,runtime_surface,readback_policy_key,partial_success_policy_key,
  atomicity_mode,status,metadata_json
)
SELECT mapping.binding_id,'github_api_mcp',mapping.endpoint_key,e.id,CONCAT('github_api_mcp__',mapping.endpoint_key),
       'github_rest_endpoint_dispatch','db_admin_tool','admin',mapping.capability_key,mapping.operation_intent,
       'runtime_endpoint_call',mapping.readback_policy_key,NULL,'single','active',
       JSON_OBJECT(
         'registry_driven',TRUE,'method_and_path_from_endpoints_only',TRUE,'provider_transport','http_generic_api',
         'admin_only',TRUE,'requires_runtime_preflight',mapping.requires_runtime_preflight,
         'requires_capability_envelope',mapping.requires_capability_envelope,
         'requires_typed_confirmation',mapping.requires_typed_confirmation,
         'requires_same_cycle_readback',TRUE,'secrets_included',FALSE
       )
FROM (
  SELECT 'ptdb_github_workflow_dispatch' AS binding_id,'github_dispatch_workflow' AS endpoint_key,
         'github_workflow_dispatch' AS capability_key,'github_workflow_dispatch' AS operation_intent,
         'github_workflow_dispatch_run_readback_v1' AS readback_policy_key,TRUE AS requires_runtime_preflight,
         TRUE AS requires_capability_envelope,'EXECUTE_RUNTIME_ENDPOINT_GITHUB_DISPATCH_WORKFLOW' AS requires_typed_confirmation
  UNION ALL
  SELECT 'ptdb_github_workflow_runs_readback','github_list_workflow_runs','github_workflow_runs_read',
         'github_workflow_runs_read','github_workflow_runs_list_readback_v1',FALSE,FALSE,NULL
) mapping
JOIN endpoints e ON e.parent_action_key='github_api_mcp' AND e.endpoint_key=mapping.endpoint_key
 AND e.status='active' AND e.execution_readiness='ready' AND e.transport_action_key='http_generic_api'
ON DUPLICATE KEY UPDATE
  source_endpoint_id=VALUES(source_endpoint_id),export_key=VALUES(export_key),tool_key=VALUES(tool_key),
  surface_class=VALUES(surface_class),scope_class=VALUES(scope_class),capability_key=VALUES(capability_key),
  operation_intent=VALUES(operation_intent),runtime_surface=VALUES(runtime_surface),
  readback_policy_key=VALUES(readback_policy_key),partial_success_policy_key=VALUES(partial_success_policy_key),
  atomicity_mode=VALUES(atomicity_mode),status=VALUES(status),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id,app_key,tool_key,tool_surface,binding_role,credential_source,exposure_scope,status,notes
) VALUES (
  'bind_tool_github_rest_endpoint_dispatch','github','github_rest_endpoint_dispatch','admin_platform_tool',
  'state_changing','platform_managed','admin','active',
  'Governed GitHub REST dispatcher; mutations require capability envelope, passive preflight, typed confirmation, and readback.'
)
ON DUPLICATE KEY UPDATE
  tool_surface=VALUES(tool_surface),binding_role=VALUES(binding_role),credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope),status=VALUES(status),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry (
  certification_key,surface_key,surface_family,tool_or_action_key,risk_class,certification_status,smoke_strategy,
  dispatch_allowed,apply_allowed,requires_resource_authority,requires_dry_run,requires_audit_evidence,
  requires_readback,last_evidence_ref,last_certified_at,expires_at,notes
) VALUES (
  'github_workflow_dispatch','runtime_endpoint_call.github_workflow_dispatch','github_repository_workflow',
  'github_workflow_dispatch','high','guarded_dispatch_policy_registered',
  'same_cycle_passive_preview_then_approved_dispatch_then_workflow_run_readback',
  1,0,1,1,1,1,'policy:runtime_endpoint_mutation_guard_v1;positive_provider_smoke=pending',NULL,NULL,
  'Dispatch is allowed only behind resource authority and explicit approval. apply_allowed remains false until a positive provider smoke is separately certified.'
)
ON DUPLICATE KEY UPDATE
  surface_key=VALUES(surface_key),surface_family=VALUES(surface_family),tool_or_action_key=VALUES(tool_or_action_key),
  risk_class=VALUES(risk_class),certification_status=VALUES(certification_status),smoke_strategy=VALUES(smoke_strategy),
  dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority),requires_dry_run=VALUES(requires_dry_run),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  last_evidence_ref=VALUES(last_evidence_ref),last_certified_at=VALUES(last_certified_at),
  expires_at=VALUES(expires_at),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies (
  policy_group,policy_key,policy_value,active,execution_scope,affects_layer,blocking,notes
) VALUES (
  'HTTP Runtime Mutation Governance','runtime_endpoint_mutation_guard_v1',
  JSON_OBJECT(
    'rule','runtime_endpoint_mutations_fail_closed_before_live_provider_dispatch',
    'runtime_surface','runtime_endpoint_call','safe_methods',JSON_ARRAY('GET','HEAD','OPTIONS'),
    'same_cycle_passive_preview_required',TRUE,'preview_must_report_outbound_request_executed',FALSE,
    'capability_envelope_status_required','ready_for_dispatch','dispatch_allowed_required',TRUE,
    'explicit_approval_required',TRUE,'typed_confirmation_pattern','EXECUTE_RUNTIME_ENDPOINT_<ENDPOINT_KEY>',
    'dry_run_preflight_completed_required',TRUE,'approved_preflight_dry_run_validated_required',TRUE,
    'live_execution_approved_required',TRUE,'concrete_same_cycle_readback_required',TRUE,
    'workflow_dispatch_readback',JSON_OBJECT(
      'dispatch_endpoint_key','github_dispatch_workflow','read_endpoint_key','github_list_workflow_runs',
      'event_filter','workflow_dispatch',
      'verify_fields',JSON_ARRAY('workflow_id','head_branch_or_ref','created_at_after_dispatch_start','status')
    ),
    'positive_provider_smoke_status','pending','secrets_included',FALSE
  ),
  'TRUE','runtime_endpoint_call|github_rest_endpoint_dispatch|provider_mutation',
  'runtimeEndpointMutationGuard|systemLayerRoutes|capability_resolution_envelope_ledger|platform_tool_dispatch_bindings',
  'TRUE',
  'Direct runtime endpoint mutations are blocked before live provider dispatch unless passive preview, capability authority, explicit confirmation, and concrete readback evidence all pass.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),active=VALUES(active),execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),blocking=VALUES(blocking),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;
