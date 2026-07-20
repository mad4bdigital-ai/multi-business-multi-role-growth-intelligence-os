-- Expand the governed resource-authority grant contract to support typed principals.
-- Legacy user_id remains accepted as a deprecated compatibility alias for user principals.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

UPDATE admin_platform_endpoint_tools
SET
  description = 'Create a bounded resource authority binding for governed GitHub repository operations or the two exact dev-only migration client shell aliases. Accepts typed user, service, or backend_api_key principals while preserving legacy user_id compatibility. Dry-run by default; apply requires TTL, expected commit SHA, typed confirmation, and same-cycle readback. No arbitrary shell, production shell execution, provider calls, or secrets.',
  input_schema = JSON_SET(
    input_schema,
    '$.required', JSON_ARRAY('tenant_id','workspace_id','resource_type','resource_uri','recipe_key','resource_ref'),
    '$.properties.user_id', JSON_OBJECT(
      'type','string',
      'format','uuid',
      'deprecated',TRUE,
      'description','Legacy compatibility alias for a user principal UUID. Prefer principal.'
    ),
    '$.properties.principal', JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('principal_type','principal_id'),
      'properties',JSON_OBJECT(
        'principal_type',JSON_OBJECT(
          'type','string',
          'enum',JSON_ARRAY('user','service','backend_api_key')
        ),
        'principal_id',JSON_OBJECT(
          'type','string',
          'minLength',1,
          'maxLength',64,
          'pattern','^[A-Za-z0-9._:-]{1,64}$',
          'description','Stable principal identifier such as a user UUID or platform_admin_service.'
        )
      ),
      'additionalProperties',FALSE
    ),
    '$.anyOf', JSON_ARRAY(
      JSON_OBJECT('required',JSON_ARRAY('principal')),
      JSON_OBJECT('required',JSON_ARRAY('user_id'))
    )
  ),
  updated_at = UTC_TIMESTAMP()
WHERE tool_key = 'platform_resource_authority_grant_apply';
