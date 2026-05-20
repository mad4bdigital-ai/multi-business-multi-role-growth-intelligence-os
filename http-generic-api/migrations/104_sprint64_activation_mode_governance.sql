-- Sprint 64: Govern Managed/Dedicated activation modes across tenant tools.
-- Purpose: make tenant GPT/tool wrappers pass canonical activation fields and fail early when required mode/device_id is missing.

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Activate the signed-in tenant workspace in governed managed or dedicated mode. Pass mode under tool_args; aliases are normalized server-side but stored as managed|dedicated.',
       `input_schema` = '{"type":"object","required":["mode"],"properties":{"mode":{"type":"string","enum":["managed","dedicated"],"description":"Canonical activation mode. Managed uses platform-managed infrastructure. Dedicated uses tenant-owned credentials/local runtime."},"connection_mode":{"type":"string","enum":["managed","dedicated"],"description":"Alias accepted by the backend; prefer mode."},"activation_mode":{"type":"string","enum":["managed","dedicated"],"description":"Alias accepted by the backend; prefer mode."},"service_mode":{"type":"string","enum":["managed","dedicated"],"description":"Alias accepted by the backend; prefer mode."},"device_id":{"type":"string","description":"Optional existing device id for follow-up installation guidance."},"workspace_name":{"type":"string"},"cloudflare_mode":{"type":"string","enum":["managed","dedicated"]},"google_auth_mode":{"type":"string","enum":["managed","dedicated"]},"n8n_activation_mode":{"type":"string","enum":["managed_main_server","self_hosted_local"]}}}',
       `tags` = 'connect,activation,mode_governed,state_changing,managed,dedicated',
       `is_enabled` = 1
 WHERE `tool_key` = 'connect_activate';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Provision or retrieve a local connector install bundle for a signed-in tenant device. Device id is required and provisioning credential mode follows the activated tenant mode.',
       `input_schema` = '{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string","pattern":"^[a-z0-9-]{2,32}$","description":"Existing or desired lowercase device id."},"hostname":{"type":"string"},"workspace_name":{"type":"string"},"provisioning_credential_mode":{"type":"string","enum":["managed","dedicated"],"description":"Optional override; defaults to connection.cloudflare_mode."},"cloudflare_connection_id":{"type":"string"},"hostinger_connection_id":{"type":"string"},"local_apps":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
       `tags` = 'connect,install,device,mode_governed,state_changing,managed,dedicated',
       `is_enabled` = 1
 WHERE `tool_key` = 'connect_device_install';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Read the signed-in tenant connection status, onboarding state, registered devices, and the governed managed/dedicated activation mode catalog.'
 WHERE `tool_key` = 'connect_status';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Return tenant capabilities and governed managed/dedicated activation mode catalog for the signed-in user.'
 WHERE `tool_key` = 'me_capabilities';
