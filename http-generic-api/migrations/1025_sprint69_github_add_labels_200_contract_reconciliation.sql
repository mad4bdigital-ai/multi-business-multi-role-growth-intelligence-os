-- Migration execution safety: no_provider_call=true; no_credential_payload_read=true;
-- no_raw_secrets=true; no_external_send=true; no_external_write=true; secrets_included=false.
--
-- Purpose:
--   Reconcile the existing github_add_issue_labels endpoint response contract
--   with GitHub's documented HTTP 200 response: an array of label objects.
--
-- Scope:
--   This migration updates one existing endpoint schema only. It does not
--   register tools, exports, dispatch bindings, routes, credentials, or provider
--   writes. The update is additive and idempotent.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.200',
      JSON_OBJECT(
        'description', 'Labels added',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'array',
              'items', JSON_OBJECT(
                'type', 'object',
                'additionalProperties', TRUE,
                'required', JSON_ARRAY('id', 'node_id', 'url', 'name', 'color', 'default'),
                'properties', JSON_OBJECT(
                  'id', JSON_OBJECT('type', 'integer'),
                  'node_id', JSON_OBJECT('type', 'string'),
                  'url', JSON_OBJECT('type', 'string'),
                  'name', JSON_OBJECT('type', 'string'),
                  'color', JSON_OBJECT('type', 'string'),
                  'default', JSON_OBJECT('type', 'boolean'),
                  'description', JSON_OBJECT('type', JSON_ARRAY('string', 'null'))
                )
              )
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-REST-039'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_add_issue_labels';
