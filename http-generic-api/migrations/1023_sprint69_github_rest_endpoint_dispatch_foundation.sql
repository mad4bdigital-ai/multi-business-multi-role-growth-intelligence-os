-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   1. Register canonical GitHub REST issue-label endpoints in the SQL endpoint authority.
--   2. Expose the existing admin-only runtime_endpoint_call kernel through the Admin tool catalog.
--   3. Bind every exposed operation to endpoint/export/dispatch integrity metadata.
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
) VALUES
(
  'ACT-GH-REST-038', 'github_api_mcp', 'github_list_issue_labels', 'listLabelsOnIssue',
  'GitHub List Issue Labels', 'https://api.github.com', 'github_rest', 'GET',
  '/repos/{owner}/{repo}/issues/{issue_number}/labels', 'github_api_mcp',
  'listLabelsOnIssue', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Issue Labels Read',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'listLabelsOnIssue', 'summary', 'GitHub List Issue Labels',
    'method', 'get', 'path', '/repos/{owner}/{repo}/issues/{issue_number}/labels',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','issue_number','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer')),
      JSON_OBJECT('name','page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','per_page','in','query','required',FALSE,'schema',JSON_OBJECT('type','integer','minimum',1,'maximum',100))
    ),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',TRUE))))),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository or issue not found'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE', 'operations_log|approved_repository_metadata',
  'Canonical read-only GitHub issue-label endpoint. Method and path resolve only from endpoints authority.'
),
(
  'ACT-GH-REST-039', 'github_api_mcp', 'github_add_issue_labels', 'addLabels',
  'GitHub Add Issue Labels', 'https://api.github.com', 'github_rest', 'POST',
  '/repos/{owner}/{repo}/issues/{issue_number}/labels', 'github_api_mcp',
  'addLabels', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Issue Labels Add',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'addLabels', 'summary', 'GitHub Add Issue Labels',
    'method', 'post', 'path', '/repos/{owner}/{repo}/issues/{issue_number}/labels',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','issue_number','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer'))
    ),
    'requestBody', JSON_OBJECT('required',TRUE,'content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','required',JSON_ARRAY('labels'),'properties',JSON_OBJECT('labels',JSON_OBJECT('type','array','minItems',1,'maxItems',100,'items',JSON_OBJECT('type','string','minLength',1,'maxLength',100))),'additionalProperties',FALSE)))),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Labels added'),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository or issue not found'),
      '422', JSON_OBJECT('description','Invalid label request'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE', 'operations_log|approved_repository_metadata',
  'Canonical GitHub issue-label mutation endpoint. Mutation remains behind runtime approval, authority, audit, and readback gates.'
),
(
  'ACT-GH-REST-040', 'github_api_mcp', 'github_set_issue_labels', 'setLabels',
  'GitHub Set Issue Labels', 'https://api.github.com', 'github_rest', 'PUT',
  '/repos/{owner}/{repo}/issues/{issue_number}/labels', 'github_api_mcp',
  'setLabels', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Issue Labels Replace',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'setLabels', 'summary', 'GitHub Set Issue Labels',
    'method', 'put', 'path', '/repos/{owner}/{repo}/issues/{issue_number}/labels',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','issue_number','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer'))
    ),
    'requestBody', JSON_OBJECT('required',TRUE,'content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','required',JSON_ARRAY('labels'),'properties',JSON_OBJECT('labels',JSON_OBJECT('type','array','maxItems',100,'items',JSON_OBJECT('type','string','minLength',1,'maxLength',100))),'additionalProperties',FALSE)))),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Labels replaced'),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository or issue not found'),
      '422', JSON_OBJECT('description','Invalid label request'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE', 'operations_log|approved_repository_metadata',
  'Canonical GitHub issue-label replacement endpoint. Mutation remains behind runtime approval, authority, audit, and readback gates.'
),
(
  'ACT-GH-REST-041', 'github_api_mcp', 'github_remove_issue_label', 'removeLabel',
  'GitHub Remove Issue Label', 'https://api.github.com', 'github_rest', 'DELETE',
  '/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', 'github_api_mcp',
  'removeLabel', 'github_com_connector', 'github_com_connector',
  'system_bootstrap>prompt_router>tool_runtime',
  'prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector',
  'operations_log', 'active', 'Source Control / Repository Operations', 'Issue Label Remove',
  'endpoint_inventory', 'official_rest_candidate', 'validated', 'validated', 'validated',
  'ready', 'primary', 'http_delegated', 'TRUE', 'http_generic_api', 'FALSE',
  JSON_OBJECT(
    'operationId', 'removeLabel', 'summary', 'GitHub Remove Issue Label',
    'method', 'delete', 'path', '/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
    'parameters', JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),
      JSON_OBJECT('name','issue_number','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer')),
      JSON_OBJECT('name','name','in','path','required',TRUE,'schema',JSON_OBJECT('type','string','minLength',1,'maxLength',100))
    ),
    'responses', JSON_OBJECT(
      '200', JSON_OBJECT('description','Label removed'),
      '301', JSON_OBJECT('description','Label renamed'),
      '401', JSON_OBJECT('description','Authentication failed'),
      '403', JSON_OBJECT('description','Authorization failed'),
      '404', JSON_OBJECT('description','Repository issue or label not found'),
      '429', JSON_OBJECT('description','Rate limited')
    )
  ),
  'delegated_http_runtime_binding', 'TRUE', 'FALSE', 'TRUE', 'operations_log|approved_repository_metadata',
  'Canonical GitHub issue-label deletion endpoint. Mutation remains behind runtime approval, authority, audit, and readback gates.'
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

-- GitHub returns 201 Created for a successfully created Git reference. Preserve
-- the existing endpoint contract while adding the missing success response so
-- runtime response validation does not misclassify a successful provider write.
UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.201',
      JSON_OBJECT(
        'description', 'Reference created',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE,
              'required', JSON_ARRAY('ref', 'object'),
              'properties', JSON_OBJECT(
                'ref', JSON_OBJECT('type', 'string'),
                'node_id', JSON_OBJECT('type', 'string'),
                'url', JSON_OBJECT('type', 'string'),
                'object', JSON_OBJECT(
                  'type', 'object',
                  'additionalProperties', TRUE,
                  'required', JSON_ARRAY('sha', 'type', 'url'),
                  'properties', JSON_OBJECT(
                    'sha', JSON_OBJECT('type', 'string'),
                    'type', JSON_OBJECT('type', 'string'),
                    'url', JSON_OBJECT('type', 'string')
                  )
                )
              )
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-EP-011'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_create_branch_reference';

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'github_rest_endpoint_dispatch',
  'GitHub REST Endpoint Dispatch',
  'Admin-only registry-driven GitHub REST dispatcher. Caller supplies only parent_action_key, endpoint_key, governed path/query/body fields, and runtime approval/readback evidence inside tool_args. Method, path, provider domain, auth, and transport resolve from active canonical endpoint rows and runtime_endpoint_call.',
  'POST',
  '/system/tools/call',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('tool_args'),
    'properties',JSON_OBJECT(
      'tool_args',JSON_OBJECT(
        'type','object',
        'required',JSON_ARRAY('parent_action_key','endpoint_key','path_params'),
        'properties',JSON_OBJECT(
          'parent_action_key',JSON_OBJECT('type','string','const','github_api_mcp'),
          'endpoint_key',JSON_OBJECT('type','string','enum',JSON_ARRAY(
            'github_update_pull_request',
            'github_list_issue_labels',
            'github_add_issue_labels',
            'github_set_issue_labels',
            'github_remove_issue_label'
          )),
          'path_params',JSON_OBJECT(
            'type','object',
            'required',JSON_ARRAY('owner','repo'),
            'properties',JSON_OBJECT(
              'owner',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$'),
              'repo',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$'),
              'pull_number',JSON_OBJECT('type','integer','minimum',1),
              'issue_number',JSON_OBJECT('type','integer','minimum',1),
              'name',JSON_OBJECT('type','string','minLength',1,'maxLength',100)
            ),
            'additionalProperties',FALSE
          ),
          'query',JSON_OBJECT(
            'type','object',
            'properties',JSON_OBJECT(
              'page',JSON_OBJECT('type','integer','minimum',1),
              'per_page',JSON_OBJECT('type','integer','minimum',1,'maximum',100)
            ),
            'additionalProperties',FALSE
          ),
          'body',JSON_OBJECT(
            'type','object',
            'properties',JSON_OBJECT(
              'title',JSON_OBJECT('type','string','minLength',1,'maxLength',256),
              'body',JSON_OBJECT('type','string','maxLength',65536),
              'state',JSON_OBJECT('type','string','enum',JSON_ARRAY('open','closed')),
              'base',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
              'labels',JSON_OBJECT('type','array','maxItems',100,'items',JSON_OBJECT('type','string','minLength',1,'maxLength',100))
            ),
            'additionalProperties',FALSE
          ),
          'credential_scope',JSON_OBJECT('type','string','enum',JSON_ARRAY('platform','auto'),'default','platform'),
          'connection_id',JSON_OBJECT('type','string'),
          'mutation_approval',JSON_OBJECT('type','object','additionalProperties',TRUE),
          'dry_run',JSON_OBJECT('type','boolean'),
          'preflight_only',JSON_OBJECT('type','boolean'),
          'dry_run_preflight_completed',JSON_OBJECT('type','boolean'),
          'approved_preflight_dry_run_validated',JSON_OBJECT('type','boolean'),
          'live_execution_approved',JSON_OBJECT('type','boolean'),
          'readback',JSON_OBJECT('type','object','additionalProperties',TRUE),
          'timeout_seconds',JSON_OBJECT('type','integer','minimum',1,'maximum',120)
        ),
        'additionalProperties',FALSE
      )
    ),
    'additionalProperties',FALSE
  ),
  JSON_OBJECT('name','runtime_endpoint_call'),
  'github,rest,registry_driven,admin_only,endpoint_authority,http_generic_api,mutation_guarded,readback,no_raw_method,no_raw_url,no_secrets',
  1,
  185
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

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
    'source','1023_sprint69_github_rest_endpoint_dispatch_foundation',
    'preserve_endpoint_contract',TRUE,
    'canonical_rows_only',TRUE
  ),
  e.schema_json,
  NULL,
  JSON_OBJECT(
    'admin_only',TRUE,
    'credential_resolution','github_app_server_side',
    'caller_supplied_authorization_forbidden',TRUE
  ),
  JSON_OBJECT(
    'dispatch_via','runtime_endpoint_call',
    'transport_action_key','http_generic_api',
    'method_and_path_from_endpoints_only',TRUE,
    'mutation_preflight_required',TRUE,
    'same_cycle_readback_required',TRUE,
    'secrets_included',FALSE
  ),
  'Registry-driven GitHub REST export. The endpoint row remains the method/path/schema authority.'
FROM endpoints e
WHERE e.parent_action_key = 'github_api_mcp'
  AND e.endpoint_id IS NOT NULL
  AND e.status = 'active'
  AND e.execution_readiness = 'ready'
  AND e.transport_action_key = 'http_generic_api'
  AND e.endpoint_key IN (
    'github_update_pull_request',
    'github_list_issue_labels',
    'github_add_issue_labels',
    'github_set_issue_labels',
    'github_remove_issue_label'
  )
ON DUPLICATE KEY UPDATE
  tool_name = VALUES(tool_name),
  scope_class = VALUES(scope_class),
  status = VALUES(status),
  source_endpoint_id = VALUES(source_endpoint_id),
  import_policy_json = VALUES(import_policy_json),
  input_schema_json = VALUES(input_schema_json),
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
  mapping.partial_success_policy_key,
  mapping.atomicity_mode,
  'active',
  JSON_OBJECT(
    'registry_driven',TRUE,
    'method_and_path_from_endpoints_only',TRUE,
    'provider_transport','http_generic_api',
    'admin_only',TRUE,
    'requires_runtime_preflight',mapping.requires_runtime_preflight,
    'requires_same_cycle_readback',mapping.requires_same_cycle_readback,
    'secrets_included',FALSE
  )
FROM (
  SELECT 'ptdb_github_rest_dispatch_pr_update' AS binding_id,
         'github_update_pull_request' AS endpoint_key,
         'github_pr_update' AS capability_key,
         'github_pr_metadata_update' AS operation_intent,
         'github_pr_state_readback_v1' AS readback_policy_key,
         NULL AS partial_success_policy_key,
         'single' AS atomicity_mode,
         TRUE AS requires_runtime_preflight,
         TRUE AS requires_same_cycle_readback
  UNION ALL
  SELECT 'ptdb_github_rest_dispatch_labels_list', 'github_list_issue_labels',
         'github_issue_labels_read', 'github_issue_labels_read',
         'github_issue_labels_list_readback_v1', NULL, 'single', FALSE, TRUE
  UNION ALL
  SELECT 'ptdb_github_rest_dispatch_labels_add', 'github_add_issue_labels',
         'github_issue_labels_update', 'github_issue_labels_add',
         'github_issue_labels_exact_readback_v1', NULL, 'single', TRUE, TRUE
  UNION ALL
  SELECT 'ptdb_github_rest_dispatch_labels_set', 'github_set_issue_labels',
         'github_issue_labels_update', 'github_issue_labels_replace',
         'github_issue_labels_exact_readback_v1', NULL, 'single', TRUE, TRUE
  UNION ALL
  SELECT 'ptdb_github_rest_dispatch_label_remove', 'github_remove_issue_label',
         'github_issue_labels_update', 'github_issue_label_remove',
         'github_issue_labels_exact_readback_v1', NULL, 'single', TRUE, TRUE
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
