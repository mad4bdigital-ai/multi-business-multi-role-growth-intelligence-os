-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Purpose:
--   Model GitHub's transient 503 response for the pull-request update-branch
--   endpoint. This is additive registry metadata only. It does not update a
--   pull request, call GitHub, read credentials, or execute provider mutations.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.503',
      JSON_OBJECT(
        'description', 'GitHub service temporarily unavailable',
        'content', JSON_OBJECT(
          'application/json', JSON_OBJECT(
            'schema', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE,
              'description', 'Transient GitHub dependency error payload. Clients may retry according to runtime policy.'
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-REST-UPDATE-BRANCH-001'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_update_pull_request_branch';

UPDATE platform_endpoint_tool_exports export_row
JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.input_schema_json = endpoint_row.schema_json,
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.parent_action_key = 'github_api_mcp'
  AND export_row.tool_name = 'github_rest_endpoint_dispatch'
  AND export_row.status = 'active'
  AND endpoint_row.endpoint_id = 'ACT-GH-REST-UPDATE-BRANCH-001'
  AND endpoint_row.endpoint_key = 'github_update_pull_request_branch';
