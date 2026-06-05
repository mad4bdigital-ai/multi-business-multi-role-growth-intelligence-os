-- Sprint 66: Tenant self-service infrastructure credential intake
-- Extends the tenant connect secure-intake tool to allow user-owned SSH
-- and remote database connections. This only creates short-lived intake links;
-- execution and CLI/database actions remain governed by follow-up readiness,
-- allowlist, and approval tools.

UPDATE tenant_platform_endpoint_tools
   SET input_schema = JSON_OBJECT(
        'type','object',
        'required',JSON_ARRAY('app_key','auth_type'),
        'properties',JSON_OBJECT(
          'app_key',JSON_OBJECT('type','string','description','App key from connect_app_integrations_list, e.g. remote_ssh_runtime or remote_mysql_database.'),
          'auth_type',JSON_OBJECT(
            'type','string',
            'enum',JSON_ARRAY('api_key','bearer_token','basic_auth','mcp','webhook','custom_headers','client_credentials','ssh_key_pair','remote_database'),
            'description','Must match the app catalog auth_type. OAuth apps use OAuth instead. SSH and remote database connections use secure intake only.'
          ),
          'display_label',JSON_OBJECT('type','string'),
          'api_base_url',JSON_OBJECT('type','string','format','uri'),
          'mcp_endpoint',JSON_OBJECT('type','string','format','uri'),
          'webhook_url',JSON_OBJECT('type','string','format','uri'),
          'workspace_id',JSON_OBJECT('type','string'),
          'expires_in_minutes',JSON_OBJECT('type','integer','minimum',1,'maximum',1440),
          'metadata',JSON_OBJECT('type','object','additionalProperties',true),
          'credential_schema',JSON_OBJECT('type','object','additionalProperties',true)
        ),
        'additionalProperties',false
      ),
       description = 'Create a tenant-scoped secure credential-intake session for app credentials, including infrastructure SSH and remote database credentials. Secrets are entered only through the intake URL and are never returned to GPT.',
       tags = 'connect,credential_intake,dedicated,state_changing,tenant_owned_credentials,no_secret_chat,infrastructure_intake',
       is_enabled = 1
 WHERE tool_key = 'connect_credential_intake_create';
