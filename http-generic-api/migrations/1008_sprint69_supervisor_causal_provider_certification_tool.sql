-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: register bounded supervisor plan-to-provider causal certification.
-- Provider dispatch only; no tools, repository mutation, local execution, or secret return.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'supervisor_causal_provider_certification',
  'Supervisor Causal Provider Certification',
  'Create one bounded supervisor certification plan and workflow run, dispatch one no-tool provider response, and retain a shared trace plus execution evidence.',
  'POST', '/admin/control', JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','supervisor_causal_provider_certification'),
      'extra_args',JSON_OBJECT(
        'type','array', 'items',JSON_OBJECT('type','string'), 'maxItems',3,
        'description','Required: --confirm=CERTIFY_SUPERVISOR_CAUSAL_PROVIDER_LANE. Optional: --max-tokens=32 --timeout-ms=30000'
      )
    ),
    'required',JSON_ARRAY('tool','action','alias','extra_args'),
    'additionalProperties',false
  ),
  NULL,
  'admin,supervisor,causal_certification,execution_plan,workflow_run,provider_dispatch,no_tools,no_repo_mutation,no_local_execution,no_secrets,bounded_cost,requires_confirmation',
  1, 229
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
