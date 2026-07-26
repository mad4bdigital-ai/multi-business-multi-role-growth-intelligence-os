-- Sprint 67: Dynamic platform secret promotion for any supported connection type.
-- Scope: registry/schema only. This does not store credential values and does
-- not change live secrets. The route change supports any encrypted
-- user_app_connections.auth_type when explicit secret mappings are supplied by
-- request or connection.account_metadata.platform_secret_mappings.

UPDATE admin_platform_endpoint_tools
   SET display_name = 'Promote Intake Connection Fields To Platform Secrets',
       description = 'Promote explicitly mapped fields from any active encrypted credential-intake connection into platform-scoped DB-encrypted secret slots. Supports all auth types accepted by credential intake, including api_key, bearer_token, mcp, webhook, basic_auth, oauth2, custom_headers, client_credentials, ssh_key_pair, and remote_database. Does not accept or return raw secret values.',
       input_schema = '{"type":"object","required":["connection_id","promotion_approved","promotion_reason"],"properties":{"connection_id":{"type":"string"},"system_id":{"type":"string","description":"Optional platform system id for secret reference metadata."},"owner_id":{"type":"string","default":"growth_intelligence_platform"},"target_key":{"type":"string","description":"Optional target/runtime key. Defaults from connection metadata or app/auth type."},"provider_family":{"type":"string","description":"Optional provider family. Defaults from connection metadata or app_key."},"connector_family":{"type":"string","description":"Optional connector family. Defaults from connection metadata or auth_type."},"promotion_approved":{"type":"boolean"},"promotion_reason":{"type":"string","minLength":12},"created_by":{"type":"string"},"secret_mappings":{"type":"array","description":"Explicit mapping from encrypted credential fields to platform secret keys. If omitted, the route reads connection.account_metadata.platform_secret_mappings.","items":{"type":"object","required":["credential_field","secret_key"],"properties":{"credential_field":{"type":"string"},"secret_key":{"type":"string"},"secret_type":{"type":"string"}}}}},"additionalProperties":false}',
       tags = 'credentials,secure_intake,platform_secret,promotion,admin,state_changing,no_secrets,no_token_returned,requires_approval,scope_gated,dynamic_auth_type',
       is_enabled = 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'credential_intake_promote_platform_secrets';

INSERT INTO app_integrations
  (app_key, display_name, description, auth_type, docs_url, category, status)
VALUES
  ('openrouter_api',
   'OpenRouter API',
   'OpenRouter API key for platform-managed OpenAI-compatible model provider bridge. Used by Docs Agent and future platform model-provider orchestration. Credentials must be entered through secure intake and promoted by mapped platform secret reference only.',
   'api_key',
   'https://openrouter.ai/docs',
   'ai_model_provider',
   'beta')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  auth_type = VALUES(auth_type),
  docs_url = VALUES(docs_url),
  category = VALUES(category),
  status = VALUES(status);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('dynamic_platform_secret_promotion_contract_v1',
   JSON_OBJECT(
     'contract_key','dynamic_platform_secret_promotion_contract_v1',
     'route','/credentials/intake/promote-platform-secrets',
     'tool_key','credential_intake_promote_platform_secrets',
     'supported_auth_types',JSON_ARRAY('api_key','bearer_token','mcp','webhook','basic_auth','oauth2','custom_headers','client_credentials','ssh_key_pair','remote_database'),
     'mapping_sources',JSON_ARRAY('request.secret_mappings','connection.account_metadata.platform_secret_mappings'),
     'raw_secret_input_allowed',false,
     'raw_secret_output_allowed',false,
     'requires_active_encrypted_connection',true,
     'requires_explicit_field_mapping',true,
     'default_secret_mapping_allowed',false,
     'secrets_included',false,
     'openrouter_mapping_example',JSON_OBJECT(
       'app_key','openrouter_api',
       'auth_type','api_key',
       'platform_secret_mappings',JSON_ARRAY(JSON_OBJECT('credential_field','api_key','secret_key','openrouter_api_key','secret_type','api_key'))
     )
   ),
   'active',
   'Dynamic platform secret promotion contract. Supports any credential-intake connection auth_type through explicit field mappings; no raw secret values are accepted or returned.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
