-- Sprint 64: Dedicated integration flow for tenant-owned apps/credentials.
-- Purpose: let tenant GPTs guide Dedicated mode users through app catalog discovery,
-- secure credential intake, connection listing, and revocation without exposing secrets.

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'connect_app_integrations_list',
    'List Connect App Integrations',
    'List tenant-connectable app integrations for Dedicated mode. No secrets are returned.',
    'GET',
    '/connect/api/app-integrations',
    NULL,
    '{"type":"object","properties":{"category":{"type":"string"},"auth_type":{"type":"string"},"status":{"type":"string","enum":["active","beta"]}}}',
    NULL,
    'connect,integrations,dedicated,read_only,tenant_owned_credentials',
    1,
    43
  ),
  (
    'connect_app_connections_list',
    'List App Connections',
    'List the signed-in tenant user app connections. Secrets and ciphertext are never returned.',
    'GET',
    '/connect/api/connections',
    NULL,
    '{"type":"object","properties":{}}',
    NULL,
    'connect,connections,dedicated,read_only,tenant_owned_credentials',
    1,
    44
  ),
  (
    'connect_credential_intake_create',
    'Create Credential Intake Link',
    'Create a short-lived secure credential intake URL for a tenant-owned integration. Do not ask users to paste secrets in chat.',
    'POST',
    '/connect/api/credential-intake/sessions',
    NULL,
    '{"type":"object","required":["app_key","auth_type"],"properties":{"app_key":{"type":"string","description":"App key from connect_app_integrations_list, e.g. cloudflare, hostinger, n8n, makecom."},"auth_type":{"type":"string","enum":["api_key","bearer_token","basic_auth","mcp","webhook","custom_headers","client_credentials"],"description":"Must match the app catalog auth_type. OAuth apps use OAuth instead."},"display_label":{"type":"string"},"api_base_url":{"type":"string","format":"uri"},"mcp_endpoint":{"type":"string","format":"uri"},"webhook_url":{"type":"string","format":"uri"},"workspace_id":{"type":"string"},"expires_in_minutes":{"type":"integer","minimum":1,"maximum":1440},"metadata":{"type":"object","additionalProperties":true},"credential_schema":{"type":"object","additionalProperties":true}}}',
    NULL,
    'connect,credential_intake,dedicated,state_changing,tenant_owned_credentials,no_secret_chat',
    1,
    45
  ),
  (
    'connect_app_connection_revoke',
    'Revoke App Connection',
    'Revoke one signed-in tenant user app connection and zero stored encrypted credentials.',
    'DELETE',
    '/connect/api/connections/{connection_id}',
    '["connection_id"]',
    '{"type":"object","required":["connection_id"],"properties":{"connection_id":{"type":"string"}}}',
    NULL,
    'connect,connections,dedicated,state_changing,tenant_owned_credentials,revoke',
    1,
    46
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Read connection status, onboarding state, registered devices, and Dedicated mode app-integration readiness for the signed-in tenant.'
 WHERE `tool_key` = 'connect_status';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Provision or retrieve a local connector install bundle. Dedicated mode blocks until required tenant-owned Cloudflare and Hostinger connections are active.'
 WHERE `tool_key` = 'connect_device_install';
