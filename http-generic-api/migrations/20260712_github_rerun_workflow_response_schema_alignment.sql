-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Purpose:
--   Align the canonical GitHub workflow-rerun endpoint response contract with the
--   successful 201 response returned by GitHub. This migration is additive metadata
--   only. It does not rerun workflows, call GitHub, read credentials, or execute
--   provider mutations.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.201.content',
      JSON_OBJECT(
        'application/json',
        JSON_OBJECT(
          'schema',
          JSON_OBJECT(
            'type', 'object',
            'additionalProperties', TRUE,
            'description', 'GitHub may return an empty response body after accepting the rerun.'
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_id = 'ACT-GH-REST-044'
  AND parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'github_rerun_workflow_run';

UPDATE platform_endpoint_tool_exports export_row
JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.input_schema_json = endpoint_row.schema_json,
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.parent_action_key = 'github_api_mcp'
  AND export_row.tool_name = 'github_rest_endpoint_dispatch'
  AND export_row.status = 'active'
  AND endpoint_row.endpoint_id = 'ACT-GH-REST-044'
  AND endpoint_row.endpoint_key = 'github_rerun_workflow_run';
