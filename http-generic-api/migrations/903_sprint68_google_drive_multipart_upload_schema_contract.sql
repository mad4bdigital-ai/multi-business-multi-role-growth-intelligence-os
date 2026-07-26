-- 903_sprint68_google_drive_multipart_upload_schema_contract.sql
-- Adds an explicit multipart/related raw-body request contract for the two
-- governed Google Drive upload endpoints used by manifest materialization.
-- The transport remains gated in executionDispatch.js by raw_body_mode,
-- parent_action_key, endpoint_key, string body, and multipart/related Content-Type.

UPDATE endpoints
SET schema_json = JSON_SET(
  schema_json,
  '$.requestBody.content."multipart/related"',
  JSON_OBJECT(
    'schema', JSON_OBJECT(
      'type', 'string',
      'description', 'Raw multipart/related request body for Google Drive uploadType=multipart. Runtime transport is additionally gated by raw_body_mode=multipart_related and endpoint allowlist.'
    )
  )
)
WHERE parent_action_key = 'google_drive_api'
  AND endpoint_key IN ('uploadNewFile', 'upload_new_file_media')
  AND JSON_VALID(schema_json)
  AND JSON_EXTRACT(schema_json, '$.requestBody.content."multipart/related"') IS NULL;
