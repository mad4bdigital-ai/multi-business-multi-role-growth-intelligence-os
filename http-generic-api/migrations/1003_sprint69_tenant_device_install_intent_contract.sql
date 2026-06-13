-- Sprint 69: Tenant device install intent and no-secret response contract.
-- Purpose:
--   1. Make add/replace/reinstall intent discoverable in the tenant tool schema.
--   2. Require typed confirmation at runtime for additional devices and reprovisioning.
--   3. Document that successful responses return a signed installer download link,
--      never connector_secret, Cloudflare tunnel tokens, .env content, or installer bodies.

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Provision the first signed-in tenant device, explicitly add or replace a device, or explicitly reinstall an existing device. Existing-device reuse is provider-call-free. Responses return metadata and a short-lived signed installer download link only; raw connector secrets, tunnel tokens, .env files, and installer bodies are never returned.',
       `input_schema` = '{"type":"object","required":["device_id"],"additionalProperties":false,"properties":{"device_id":{"type":"string","pattern":"^[a-z0-9-]{2,32}$","description":"Desired lowercase device id."},"hostname":{"type":"string","description":"Optional governed runtime hostname under mad4b.com."},"workspace_name":{"type":"string"},"install_intent":{"type":"string","enum":["add","replace","reinstall"],"description":"Required when another active device exists. Use reinstall only with reprovision=true for the same registered device."},"typed_confirmation":{"type":"string","pattern":"^INSTALL_DEVICE_[A-Z0-9_]+$","description":"Required for add/replace/reinstall. Runtime expects INSTALL_DEVICE_<DEVICE_ID> with non-alphanumeric characters normalized to underscores."},"reprovision":{"type":"boolean","default":false,"description":"Explicitly rotate/reprovision an existing device. Requires install_intent=reinstall and typed_confirmation."},"provisioning_credential_mode":{"type":"string","enum":["managed","dedicated"],"description":"Optional override; defaults to the governed tenant integration policy."},"cloudflare_connection_id":{"type":"string"},"hostinger_connection_id":{"type":"string"},"local_apps":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
       `tags` = 'connect,install,device,mode_governed,state_changing,explicit_intent,typed_confirmation,no_raw_secrets,signed_download_link',
       `is_enabled` = 1
 WHERE `tool_key` = 'connect_device_install';
