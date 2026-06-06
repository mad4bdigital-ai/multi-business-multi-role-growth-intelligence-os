-- Sprint 66: Tenant SSH password support and credential-intake wait tool
-- Adds a tenant-safe long-poll tool for secure credential intake completion.
-- The route returns only session/connection metadata and never returns submitted secrets.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'connect_credential_intake_wait',
  'Connect Credential Intake Wait',
  'Wait for a tenant credential-intake session to complete and return the resulting connection_id without exposing submitted secrets. Supports automated post-intake verification flows instead of manual chat handoff.',
  'GET',
  '/connect/api/credential-intake/sessions/{session_id}/wait',
  JSON_ARRAY('session_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('session_id'),
    'properties',JSON_OBJECT(
      'session_id',JSON_OBJECT('type','string'),
      'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',60000,'default',15000),
      'interval_ms',JSON_OBJECT('type','integer','minimum',250,'maximum',5000,'default',1000)
    ),
    'additionalProperties',false
  ),
  NULL,
  'connect,credential_intake,wait,long_poll,tenant,read_only,no_secrets,auth_scoped,automation,webhook_safe',
  1,
  121
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

UPDATE tenant_platform_endpoint_tools
   SET description = 'Create a tenant-scoped secure credential-intake session for app credentials, including infrastructure SSH password/private-key and remote database credentials. Secrets are entered only through the intake URL and are never returned to GPT.'
 WHERE tool_key = 'connect_credential_intake_create';
