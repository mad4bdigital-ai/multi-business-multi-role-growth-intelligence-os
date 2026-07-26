-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   Reconcile the existing github_create_branch_reference endpoint response
--   contract with GitHub's documented HTTP 201 Created success response.
--
-- Scope:
--   This migration updates one existing endpoint schema only. It does not
--   register tools, exports, dispatch bindings, routes, credentials, or provider
--   writes. The update is additive and idempotent.

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
