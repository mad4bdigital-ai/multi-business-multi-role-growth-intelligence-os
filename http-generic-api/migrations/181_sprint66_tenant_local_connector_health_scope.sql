-- Sprint 66: Tenant local connector health scoping
-- Tenant calls derive user_id and tenant_id from the signed-in user JWT.
-- Admin/service calls may still pass explicit ids. Tenant GPT must not ask for
-- or send user_id/tenant_id when checking connector devices or health.

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'List registered local connector devices for the signed-in tenant user. user_id and tenant_id are derived from the tenant JWT and must not be provided by Tenant GPT.',
       `input_schema` = '{"type":"object","properties":{}}',
       `tags` = 'connector,tenant_safe,auth_derived'
 WHERE `tool_key` = 'local_connector_devices';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Check local connector reachability for a signed-in tenant device. Tenant calls provide only device_id; user_id and tenant_id are derived from the tenant JWT.',
       `input_schema` = '{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string","pattern":"^[A-Za-z0-9_.-]{2,64}$","description":"Registered or alias device id to check."}}}',
       `tags` = 'connector,tenant_safe,auth_derived,health'
 WHERE `tool_key` = 'local_connector_health';
