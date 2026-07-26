-- 20260717_runtime_contract_root_cause_reconciliation.sql
-- Reconcile governed runtime contracts discovered during activation and provider diagnostics.

-- Pin admin_hostinger to the validated platform-owned connection and expose the
-- supported connection_id argument in the governed tool contract.
UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      COALESCE(
        input_schema,
        JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(),
          'additionalProperties', FALSE
        )
      ),
      '$.properties.connection_id',
      JSON_OBJECT(
        'type', 'string',
        'format', 'uuid',
        'description', 'Validated platform-owned Hostinger connection identifier.'
      )
    ),
    fixed_body = JSON_SET(
      COALESCE(fixed_body, JSON_OBJECT()),
      '$.connection_id',
      'd43275c7-2e41-4686-9c32-b3fff36efb7d'
    ),
    description = 'Hostinger API via the validated platform-owned connection. Supports read-only diagnostics and governed provider operations.'
WHERE tool_key = 'admin_hostinger';

-- Export the existing non-mutating activation session-context route so retries
-- and diagnostics do not open duplicate sessions.
INSERT INTO admin_platform_endpoint_tools (
  tool_key,
  display_name,
  description,
  http_method,
  http_path,
  path_param_keys,
  input_schema,
  fixed_body,
  tags,
  is_enabled,
  sort_order
)
VALUES (
  'activation_session_context_read_only',
  'Activation Session Context Read Only',
  'Read the authorized activation session context without opening or mutating a session.',
  'GET',
  '/activation/session-context/read-only',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'limit', JSON_OBJECT('type', 'integer', 'minimum', 1, 'maximum', 50, 'default', 10),
      'offset', JSON_OBJECT('type', 'integer', 'minimum', 0, 'default', 0),
      'include_raw', JSON_OBJECT('type', 'boolean', 'default', FALSE),
      'raw_max_chars', JSON_OBJECT('type', 'integer', 'minimum', 1, 'maximum', 20000, 'default', 4000),
      'max_response_chars', JSON_OBJECT('type', 'integer', 'minimum', 5000, 'maximum', 150000, 'default', 45000),
      'chunk_ttl_minutes', JSON_OBJECT('type', 'integer', 'minimum', 5, 'maximum', 120, 'default', 20)
    ),
    'additionalProperties', FALSE
  ),
  JSON_OBJECT(),
  'activation,session,read_only,diagnostic',
  1,
  91
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

-- Archive every historical duplicate for the old operationId while preserving
-- an array response contract for audit and recovery reads.
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
    status = 'archived',
    legacy_status = 'superseded_by_github_list_repository_issues',
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_key = 'listRepositoryIssues'
  AND method IN ('get', 'GET')
  AND endpoint_path_or_function = '/repos/{owner}/{repo}/issues';

-- The chunk endpoint is a platform proxy path but is currently delegated to
-- api.github.com, producing a deterministic 404. Archive it until a real local
-- proxy handler is registered and validated.
UPDATE endpoints
SET status = 'archived',
    legacy_status = 'degraded_contract_proxy_path_misrouted',
    updated_at = CURRENT_TIMESTAMP
WHERE endpoint_key = 'github_get_git_blob_chunk'
  AND endpoint_path_or_function = '/proxy/repos/{owner}/{repo}/git/blobs/{file_sha}/chunk';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
