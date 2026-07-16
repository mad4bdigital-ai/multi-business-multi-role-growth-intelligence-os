-- 20260716_github_list_repository_issues_array_contract.sql
-- Reconcile the GitHub list-repository-issues success response with the provider.
-- GitHub returns a JSON array of issue and pull-request-shaped objects, not one
-- object. Keep the endpoint additive and prevent valid reads from being rejected
-- as response schema drift.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.200.content."application/json".schema',
      JSON_OBJECT(
        'type', 'array',
        'items', JSON_OBJECT(
          'type', 'object',
          'additionalProperties', TRUE
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-REST-023'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_list_repository_issues';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
