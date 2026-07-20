-- 20260718_repair_activation_session_context_tool_registration.sql
-- Repair the admin tool registry after an explicit UUID was supplied to an
-- INT AUTO_INCREMENT primary key and the existing health_check row was updated.

UPDATE admin_platform_endpoint_tools
SET display_name = 'Health Check',
    description = 'Service health and DB connectivity.',
    http_method = 'GET',
    http_path = '/health',
    path_param_keys = NULL,
    input_schema = NULL,
    fixed_body = NULL,
    tags = 'system',
    is_enabled = 1,
    sort_order = 10
WHERE tool_key = 'health_check';

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

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
