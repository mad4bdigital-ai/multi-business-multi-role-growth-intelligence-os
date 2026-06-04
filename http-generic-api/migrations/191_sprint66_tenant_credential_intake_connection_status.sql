-- Sprint 66: Tenant-safe credential intake connection status
-- Adds a governed tenant tool for checking secure credential-intake completion
-- by connection_id. The route is read-only, auth-scoped, and never returns
-- decrypted credentials or secret values.

INSERT INTO tenant_platform_endpoint_tools (
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
) VALUES (
  'credential_intake_connection_status',
  'Credential Intake Connection Status',
  'Read tenant-scoped secure credential-intake completion status by connection_id. This is the supported post-submit status path for Tenant GPTs; it never returns raw or decrypted secrets and does not require DB access.',
  'GET',
  '/me/connections/{connection_id}/credential-intake-status',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string','description','Connection ID returned after secure credential intake submission')
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,credential-intake,connection,status,read_only,no_secrets,auth_scoped',
  1,
  308
) ON DUPLICATE KEY UPDATE
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
