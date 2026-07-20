-- 20260720_github_raw_contents_text_response_contract.sql
-- Synchronize getFileContents with the runtime raw-text response classifier.
-- JSON remains available for metadata mode; explicit GitHub raw requests
-- declare string responses and skip JSON schema enforcement.

UPDATE endpoints
SET schema_json = JSON_SET(
      schema_json,
      '$.responses."200".content."text/plain".schema', JSON_OBJECT(
        'type', 'string',
        'description', 'Raw GitHub file contents returned as UTF-8 text.'
      ),
      '$.responses."200".content."application/vnd.github.raw".schema', JSON_OBJECT(
        'type', 'string',
        'description', 'Raw GitHub file contents returned for the GitHub raw media type.'
      )
    ),
    notes = CONCAT_WS('\n', NULLIF(notes, ''), '2026-07-20: Added explicit raw-text response contract; JSON remains the default metadata response.'),
    last_reviewed_at = '2026-07-20'
WHERE parent_action_key = 'github_api_mcp'
  AND endpoint_key = 'getFileContents';

-- backward_compatible=true
-- no_provider_mutation=true
-- no_external_write=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- same_cycle_readback_required=true
-- secrets_included=false
