-- Sprint 69: Activation run archive lookup and dynamic admin_control resource authority.
-- Additive registry/API contract only. No provider calls, credentials, or target mutations.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
  ('activation_run_archive_get', 'Activation Run Archive Get', 'Resolve an activation run id to its session archive for an authorized platform admin.', 'GET', '/activation/runs/{runId}/archive', JSON_ARRAY('runId'), JSON_OBJECT('type','object','required',JSON_ARRAY('runId'),'properties',JSON_OBJECT('runId',JSON_OBJECT('type','string')),'additionalProperties',FALSE), NULL, 'activation,session,archive,read_only,no_secrets,admin', 47, 1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), tags=VALUES(tags), sort_order=VALUES(sort_order), is_enabled=VALUES(is_enabled), updated_at=CURRENT_TIMESTAMP;

INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
  ('tenant_activation_run_archive_get', 'Tenant Activation Run Archive Get', 'Resolve an activation run id to the signed tenant user own session archive.', 'GET', '/tenant/activation/runs/{runId}/archive', JSON_ARRAY('runId'), JSON_OBJECT('type','object','required',JSON_ARRAY('runId'),'properties',JSON_OBJECT('runId',JSON_OBJECT('type','string')),'additionalProperties',FALSE), NULL, 'activation,session,archive,read_only,no_secrets,tenant,owner_scoped', 47, 1)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), tags=VALUES(tags), sort_order=VALUES(sort_order), is_enabled=VALUES(is_enabled), updated_at=CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_SET(
     CAST(input_schema AS JSON),
     '$.properties.authority_context',
     JSON_OBJECT(
       'type','object',
       'description','Dynamic resource authority context resolved from platform_resource_authority_bindings, connected_systems, installations, and workspace_resource_grants.',
       'properties',JSON_OBJECT(
         'tenant_id',JSON_OBJECT('type','string'), 'user_id',JSON_OBJECT('type','string'), 'owner_user_id',JSON_OBJECT('type','string'),
         'workspace_id',JSON_OBJECT('type','string'), 'workspace_key',JSON_OBJECT('type','string'),
         'brand_key',JSON_OBJECT('type','string'), 'brand_ref',JSON_OBJECT('type','string'),
         'resource_type',JSON_OBJECT('type','string'), 'resource_uri',JSON_OBJECT('type','string'),
         'operation_mode',JSON_OBJECT('type','string'), 'source_system_id',JSON_OBJECT('type','string'),
         'source_installation_id',JSON_OBJECT('type','string'),
         'owner_refs',JSON_OBJECT('type','array','maxItems',20,'items',JSON_OBJECT('type','object','required',JSON_ARRAY('resource_type','resource_ref'),'properties',JSON_OBJECT('resource_type',JSON_OBJECT('type','string'),'resource_ref',JSON_OBJECT('type','string')),'additionalProperties',FALSE))
       ),
       'additionalProperties',FALSE
     )
   ), updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'admin_control';

INSERT INTO execution_policies
  (policy_key, policy_group, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('dynamic_admin_control_resource_authority_v1', 'Admin Control Governance', JSON_OBJECT(
    'rule','admin_control mutations require an active dynamic resource authority binding; tenant calls additionally require signed-principal ownership grants.',
    'authority_sources',JSON_ARRAY('platform_resource_authority_bindings','workspace_resource_grants','connected_systems','installations'),
    'provider_or_connection_type_allowlist_required',FALSE,
    'allowed_mode_source','allowed_modes_json',
    'tenant_identity_source','signed_jwt_only',
    'secrets_included',FALSE
  ), 'TRUE', 'gpt_tools_call|tool_dispatch|admin_control', 'governedExecutionPreflight|dynamicResourceAuthority|gptToolsRoutes', 'TRUE', 'Dynamic authority is resource and operation scoped; it does not infer permission from a hard-coded provider or connection type.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
