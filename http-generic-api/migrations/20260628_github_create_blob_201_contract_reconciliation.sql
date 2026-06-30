-- 20260628_github_create_blob_201_contract_reconciliation.sql
-- Reconcile GitHub create-blob success semantics. GitHub returns HTTP 201 with
-- a compact { sha, url } object. Keep the existing endpoint additive and
-- backward-compatible while preventing successful writes from being
-- misclassified as response schema drift.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.201',
      JSON_OBJECT(
        'description', 'Blob created',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE,
              'required', JSON_ARRAY('sha', 'url'),
              'properties', JSON_OBJECT(
                'sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
                'url', JSON_OBJECT('type', 'string', 'format', 'uri')
              )
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-REST-029'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_create_blob';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
