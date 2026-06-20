-- Idempotent tenant-safe route drift guard for GPT-visible tools.
-- Reassert auth-derived read-only routes and fail closed if these rows drift
-- to admin-only or raw connector proxy paths.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

UPDATE `tenant_platform_endpoint_tools`
   SET `http_method` = 'GET',
       `http_path` = '/local/tools',
       `path_param_keys` = '[]',
       `input_schema` = '{"type":"object","properties":{}}',
       `tags` = 'local_gateway,device,tenant_safe,read_only,auth_derived',
       `is_enabled` = 1
 WHERE `tool_key` = 'local_gateway_tools_list';

UPDATE `tenant_platform_endpoint_tools`
   SET `http_method` = 'GET',
       `http_path` = '/local-connector/devices',
       `path_param_keys` = '[]',
       `input_schema` = '{"type":"object","properties":{}}',
       `tags` = 'connector,tenant_safe,auth_derived,read_only',
       `is_enabled` = 1
 WHERE `tool_key` = 'local_connector_devices';

UPDATE `tenant_platform_endpoint_tools`
   SET `http_method` = 'GET',
       `http_path` = '/local-connector/health',
       `path_param_keys` = '[]',
       `input_schema` = '{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string","pattern":"^[A-Za-z0-9_.-]{2,64}$"}}}',
       `tags` = 'connector,tenant_safe,auth_derived,health,read_only',
       `is_enabled` = 1
 WHERE `tool_key` = 'local_connector_health';

UPDATE `tenant_platform_endpoint_tools`
   SET `http_method` = 'GET',
       `http_path` = '/me/scope-grants',
       `path_param_keys` = '[]',
       `input_schema` = '{"type":"object","properties":{"active_only":{"type":"boolean","default":true}}}',
       `tags` = 'tenant,scope_grant,read_only,auth_derived',
       `is_enabled` = 1
 WHERE `tool_key` = 'me_scope_grants_list';

UPDATE `tenant_platform_endpoint_tools`
   SET `is_enabled` = 0,
       `tags` = CONCAT(COALESCE(`tags`, ''), ',disabled_admin_path_drift'),
       `description` = CONCAT(COALESCE(`description`, ''), ' Disabled by tenant-safe route rebinding: tenant-visible tools must not point at admin-only paths.')
 WHERE `tool_key` IN ('local_gateway_tools_list','local_connector_devices','local_connector_health','me_scope_grants_list')
   AND (`http_path` LIKE '/admin/%' OR `http_path` LIKE '/admin' OR `http_path` LIKE '/connector/%');
