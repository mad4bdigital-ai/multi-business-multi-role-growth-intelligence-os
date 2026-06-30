-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- GitHub returns the complete issue-label array for add, replace, and remove
-- operations. Migration 1023 described the 200 responses but omitted their
-- content schemas, causing successful provider writes to be misclassified as
-- response_schema_missing. This additive migration aligns the canonical
-- endpoint contracts and their exported registry copies.

UPDATE endpoints
SET schema_json = JSON_SET(
      COALESCE(schema_json, JSON_OBJECT()),
      '$.responses.200.content',
      JSON_OBJECT(
        'application/json', JSON_OBJECT(
          'schema', JSON_OBJECT(
            'type', 'array',
            'items', JSON_OBJECT(
              'type', 'object',
              'additionalProperties', TRUE,
              'required', JSON_ARRAY('id', 'name', 'color', 'default'),
              'properties', JSON_OBJECT(
                'id', JSON_OBJECT('type', 'integer'),
                'node_id', JSON_OBJECT('type', 'string'),
                'url', JSON_OBJECT('type', 'string'),
                'name', JSON_OBJECT('type', 'string'),
                'color', JSON_OBJECT('type', 'string'),
                'default', JSON_OBJECT('type', 'boolean'),
                'description', JSON_OBJECT(
                  'anyOf', JSON_ARRAY(
                    JSON_OBJECT('type', 'string'),
                    JSON_OBJECT('type', 'null')
                  )
                )
              )
            )
          )
        )
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE parent_action_key = 'github_api_mcp'
  AND endpoint_id IN ('ACT-GH-REST-039', 'ACT-GH-REST-040', 'ACT-GH-REST-041')
  AND endpoint_key IN (
    'github_add_issue_labels',
    'github_set_issue_labels',
    'github_remove_issue_label'
  );

UPDATE platform_endpoint_tool_exports export_row
JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.input_schema_json = endpoint_row.schema_json,
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.parent_action_key = 'github_api_mcp'
  AND export_row.tool_name = 'github_rest_endpoint_dispatch'
  AND export_row.status = 'active'
  AND endpoint_row.endpoint_id IN ('ACT-GH-REST-039', 'ACT-GH-REST-040', 'ACT-GH-REST-041')
  AND endpoint_row.endpoint_key IN (
    'github_add_issue_labels',
    'github_set_issue_labels',
    'github_remove_issue_label'
  );
