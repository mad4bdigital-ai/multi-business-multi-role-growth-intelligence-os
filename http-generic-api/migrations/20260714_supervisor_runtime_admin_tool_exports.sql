-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true; no_raw_secrets=true;
-- no_external_send=true; no_external_write=true; secrets_included=false.
-- Export existing supervisor readiness and transaction-rollback certification scripts as governed Admin tools.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'supervisor_runtime_readiness',
  'Supervisor Runtime Readiness',
  'Run the existing supervisor runtime readiness contract. Default mode is static/read-only; optional --live performs database readback without provider calls or external writes.',
  'POST', '/admin/control', JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string','enum',JSON_ARRAY('--live')),
        'maxItems',1,
        'description','Optional --live enables read-only database readiness checks.'
      )
    ),
    'additionalProperties',false
  ),
  JSON_OBJECT('tool','shell','action','run','alias','supervisor_runtime_readiness'),
  'admin,supervisor,readiness,read_only,database_readback,no_provider_calls,no_external_write,no_secrets',
  1, 230
),
(
  'supervisor_behavioral_certification',
  'Supervisor Behavioral Certification',
  'Run the existing supervisor behavioral certification. Default mode is dry-run. Apply requires --apply and --confirm=APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION; fixtures are rolled back and provider_calls remains zero.',
  'POST', '/admin/control', JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string'),
        'maxItems',2,
        'description','Dry-run uses no arguments. Apply requires exactly --apply and --confirm=APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION.'
      )
    ),
    'additionalProperties',false
  ),
  JSON_OBJECT('tool','shell','action','run','alias','supervisor_behavioral_certification'),
  'admin,supervisor,behavioral_certification,transaction_rollback,no_provider_calls,no_external_write,no_secrets,requires_confirmation',
  1, 231
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
