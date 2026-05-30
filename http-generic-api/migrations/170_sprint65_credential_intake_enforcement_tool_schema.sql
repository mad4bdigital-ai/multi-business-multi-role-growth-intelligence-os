-- Sprint 65: dynamic credential intake enforcement schema flags
-- Enables credential effective status/plan tools to request a short-lived secure intake URL
-- when the resolver reports blocked_missing_secret. Responses remain no-secret.

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_OBJECT(
     'type', 'object',
     'required', JSON_ARRAY('tenant_id', 'credential_role'),
     'properties', JSON_OBJECT(
       'tenant_id', JSON_OBJECT('type','string'),
       'user_id', JSON_OBJECT('type','string'),
       'connection_id', JSON_OBJECT('type','string'),
       'app_key', JSON_OBJECT('type','string'),
       'auth_type', JSON_OBJECT('type','string'),
       'display_label', JSON_OBJECT('type','string'),
       'action_key', JSON_OBJECT('type','string'),
       'target_key', JSON_OBJECT('type','string'),
       'credential_role', JSON_OBJECT('type','string'),
       'credential_field', JSON_OBJECT('type','string'),
       'credential_label', JSON_OBJECT('type','string'),
       'credential_schema', JSON_OBJECT('type','object'),
       'allow_platform_fallback', JSON_OBJECT('type','boolean','default',true),
       'enforce_intake', JSON_OBJECT('type','boolean','default',false),
       'auto_intake', JSON_OBJECT('type','boolean','default',false),
       'expires_in_minutes', JSON_OBJECT('type','integer','minimum',1,'maximum',1440)
     ),
     'additionalProperties', false
   )
 WHERE tool_key = 'credential_effective_plan';

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_OBJECT(
     'type', 'object',
     'required', JSON_ARRAY('tenantId', 'credentialRole'),
     'properties', JSON_OBJECT(
       'tenantId', JSON_OBJECT('type','string'),
       'tenant_id', JSON_OBJECT('type','string'),
       'userId', JSON_OBJECT('type','string'),
       'user_id', JSON_OBJECT('type','string'),
       'connectionId', JSON_OBJECT('type','string'),
       'connection_id', JSON_OBJECT('type','string'),
       'appKey', JSON_OBJECT('type','string'),
       'app_key', JSON_OBJECT('type','string'),
       'authType', JSON_OBJECT('type','string'),
       'auth_type', JSON_OBJECT('type','string'),
       'displayLabel', JSON_OBJECT('type','string'),
       'display_label', JSON_OBJECT('type','string'),
       'actionKey', JSON_OBJECT('type','string'),
       'action_key', JSON_OBJECT('type','string'),
       'targetKey', JSON_OBJECT('type','string'),
       'target_key', JSON_OBJECT('type','string'),
       'credentialRole', JSON_OBJECT('type','string'),
       'credential_role', JSON_OBJECT('type','string'),
       'credentialField', JSON_OBJECT('type','string'),
       'credential_field', JSON_OBJECT('type','string'),
       'credentialLabel', JSON_OBJECT('type','string'),
       'credential_label', JSON_OBJECT('type','string'),
       'credentialSchema', JSON_OBJECT('type','object'),
       'credential_schema', JSON_OBJECT('type','object'),
       'allowPlatformFallback', JSON_OBJECT('type','boolean'),
       'allow_platform_fallback', JSON_OBJECT('type','boolean'),
       'enforceIntake', JSON_OBJECT('type','boolean'),
       'enforce_intake', JSON_OBJECT('type','boolean'),
       'autoIntake', JSON_OBJECT('type','boolean'),
       'auto_intake', JSON_OBJECT('type','boolean'),
       'expiresInMinutes', JSON_OBJECT('type','integer','minimum',1,'maximum',1440),
       'expires_in_minutes', JSON_OBJECT('type','integer','minimum',1,'maximum',1440)
     ),
     'additionalProperties', false
   )
 WHERE tool_key = 'credential_effective_status';
