-- Sprint 61: Parent Action External Auth Strategy
--
-- Makes parent actions the default source of truth for external endpoint
-- credential-selection behavior. Endpoints inherit this policy and may override
-- only through endpoints.runtime_binding_profile.auth_strategy_override.
--
-- Runtime call shape supports:
--   credential_scope = platform | user | tenant | connection | auto
--   user_id / tenant_id / connection_id / app_key / scopes / auth_type
--   allow_platform_fallback
--   auth_context object with the same fields
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

UPDATE actions a
LEFT JOIN app_integration_action_bindings b
  ON b.action_key = a.action_key
 AND b.status = 'active'
SET a.runtime_binding_profile = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(a.runtime_binding_profile,''),'{}'))
          THEN COALESCE(NULLIF(a.runtime_binding_profile,''),'{}')
        ELSE '{}'
      END,
      '$.auth_strategy',
      JSON_OBJECT(
        'auth_strategy_version', 1,
        'default_scope', 'platform',
        'supported_scopes', JSON_ARRAY('platform','tenant','user','connection'),
        'credential_resolution_order', JSON_ARRAY('request_connection','user_primary_connection','tenant_primary_connection','platform_secret'),
        'allow_platform_fallback_default', true,
        'allowed_auth_types',
          CASE
            WHEN a.api_key_mode IN ('google_oauth2','google_ads_oauth2') THEN JSON_ARRAY('oauth2')
            WHEN a.api_key_mode = 'github_app' THEN JSON_ARRAY('bearer_token','oauth2')
            WHEN a.api_key_mode = 'basic_auth_app_password' THEN JSON_ARRAY('basic_auth')
            WHEN a.api_key_mode = 'custom_headers' THEN JSON_ARRAY('custom_headers')
            WHEN a.api_key_mode = 'bearer_token' THEN JSON_ARRAY('bearer_token','api_key','oauth2')
            WHEN a.api_key_mode IN ('custom_api','api_key') OR a.api_key_header_name <> '' OR a.api_key_param_name <> '' THEN JSON_ARRAY('api_key','bearer_token','custom_headers')
            ELSE JSON_ARRAY('oauth2','api_key','bearer_token','basic_auth','custom_headers','client_credentials')
          END,
        'app_key', COALESCE(NULLIF(b.app_key,''), NULLIF(a.action_key,''), NULLIF(a.connector_family,'')),
        'required_scopes',
          CASE
            WHEN a.api_key_mode IN ('google_oauth2','google_ads_oauth2') THEN JSON_ARRAY('https://www.googleapis.com/auth/drive')
            ELSE JSON_ARRAY()
          END
      )
    ),
    a.updated_at = CURRENT_TIMESTAMP
WHERE a.status = 'active'
  AND (a.runtime_capability_class = 'external_action_only'
       OR a.primary_executor = 'http_client_backend'
       OR a.api_key_mode IS NOT NULL);

UPDATE platform_endpoint_tool_exports p
JOIN actions a ON a.action_key = p.parent_action_key
SET p.input_schema_json = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(p.input_schema_json,''),'{}'))
          THEN COALESCE(NULLIF(p.input_schema_json,''),'{}')
        ELSE '{"type":"object","properties":{}}'
      END,
      '$.properties.user_id', JSON_OBJECT('type','string','description','Optional user credential owner for credential_scope=user.'),
      '$.properties.tenant_id', JSON_OBJECT('type','string','description','Optional tenant credential owner for credential_scope=tenant.'),
      '$.properties.credential_scope', JSON_OBJECT('type','string','enum',JSON_ARRAY('platform','user','tenant','connection','auto'),'description','Credential resolution preference for external endpoints. Defaults to the parent action auth_strategy.'),
      '$.properties.connection_id', JSON_OBJECT('type','string','description','Optional explicit user_app_connections.connection_id for credential_scope=connection.'),
      '$.properties.app_key', JSON_OBJECT('type','string','description','Optional app_key override for user_app_connections lookup.'),
      '$.properties.scopes', JSON_OBJECT('type','string','description','Optional required scope list for OAuth connection lookup.'),
      '$.properties.auth_type', JSON_OBJECT('type','string','description','Optional auth_type override for user_app_connections lookup.'),
      '$.properties.allow_platform_fallback', JSON_OBJECT('type','boolean','description','Allow fallback to parent-action platform credentials when scoped credentials are unavailable.'),
      '$.properties.auth_context', JSON_OBJECT('type','object','additionalProperties',true,'description','Advanced auth context: credential_scope, connection_id, user_id, tenant_id, app_key, scopes, auth_type, allow_platform_fallback.')
    ),
    p.auth_policy_json = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(p.auth_policy_json,''),'{}'))
          THEN COALESCE(NULLIF(p.auth_policy_json,''),'{}')
        ELSE '{}'
      END,
      '$.inherits_parent_action_auth_strategy', true,
      '$.supports_runtime_credential_scope', true,
      '$.credential_scope_options', JSON_ARRAY('platform','user','tenant','connection','auto')
    ),
    p.updated_at = CURRENT_TIMESTAMP
WHERE p.status = 'active'
  AND (a.runtime_capability_class = 'external_action_only'
       OR a.primary_executor = 'http_client_backend');
