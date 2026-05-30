-- Sprint 65: post-intake local connector direct fallback key promotion tool
-- Promotes an encrypted user_app_connections API key into the per-device
-- local_connector_user_configs.connector_local_api_key field without returning secrets.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, input_schema, tags, is_enabled, sort_order)
VALUES
  (
    'credential_intake_promote_local_connector_key',
    'Promote Intake Credential To Local Connector Key',
    'Admin-only post-intake promotion that decrypts an active user_app_connection server-side and writes its API key into local_connector_user_configs.connector_local_api_key for one user/tenant/device. Never returns secret values.',
    'POST',
    '/credentials/intake/promote-local-connector-key',
    JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY('tenant_id','user_id','device_id','connection_id'),
      'properties', JSON_OBJECT(
        'tenant_id', JSON_OBJECT('type','string'),
        'user_id', JSON_OBJECT('type','string'),
        'device_id', JSON_OBJECT('type','string'),
        'connection_id', JSON_OBJECT('type','string'),
        'credential_field', JSON_OBJECT('type','string','default','api_key'),
        'target_field', JSON_OBJECT('type','string','enum',JSON_ARRAY('connector_local_api_key'),'default','connector_local_api_key'),
        'created_by', JSON_OBJECT('type','string')
      ),
      'additionalProperties', false
    ),
    'credentials,secure_intake,local_connector,admin,state_changing,no_secrets',
    1,
    363
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
