-- 2026-07-08: GitHub create-tree endpoint execution/readback contract fix.
-- SQL-primary registry repair only. No provider calls, no credential payload reads, no raw secrets.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

UPDATE endpoints
SET schema_json = JSON_SET(
      schema_json,
      '$."responses"."201"',
      JSON_OBJECT(
        'description', 'Created',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', CAST(TRUE AS JSON),
              'required', JSON_ARRAY('sha', 'tree'),
              'properties', JSON_OBJECT(
                'sha', JSON_OBJECT('type', 'string'),
                'url', JSON_OBJECT('type', 'string'),
                'truncated', JSON_OBJECT('type', 'boolean'),
                'tree', JSON_OBJECT(
                  'type', 'array',
                  'items', JSON_OBJECT('type', 'object', 'additionalProperties', CAST(TRUE AS JSON))
                )
              )
            )
          )
        )
      )
    ),
    privacy_validation_status = COALESCE(privacy_validation_status, 'validated'),
    updated_at = UTC_TIMESTAMP(),
    notes = TRIM(CONCAT(COALESCE(notes, ''), ' 2026-07-08: Added 201 Created response schema for GitHub create-tree to resolve schema drift.'))
WHERE parent_action_key='github_api_mcp'
  AND endpoint_key IN ('github_create_tree','createTree')
  AND JSON_VALID(schema_json) = 1;

UPDATE endpoints
SET execution_readiness='ready',
    endpoint_role='primary',
    execution_mode='http_delegated',
    transport_required='TRUE',
    auth_validation_status=COALESCE(auth_validation_status, 'validated'),
    spec_validation_status=COALESCE(spec_validation_status, 'validated'),
    privacy_validation_status=COALESCE(privacy_validation_status, 'validated'),
    updated_at=UTC_TIMESTAMP(),
    notes=TRIM(CONCAT(COALESCE(notes, ''), ' 2026-07-08: Promoted compiled GitHub createTree endpoint to execution-ready alias of github_create_tree.'))
WHERE parent_action_key='github_api_mcp'
  AND endpoint_key='createTree';
