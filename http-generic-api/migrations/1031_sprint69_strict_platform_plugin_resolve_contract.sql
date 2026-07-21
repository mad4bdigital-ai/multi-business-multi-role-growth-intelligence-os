-- Sprint 69: enforce the strict one-selector Platform Plugin resolve contract in tool registries.
-- Runtime route validation is implemented in code; this migration aligns registered tool schemas.

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = JSON_OBJECT(
         'type', 'object',
         'required', JSON_ARRAY('plugin_key'),
         'additionalProperties', false,
         'oneOf', JSON_ARRAY(
           JSON_OBJECT('required', JSON_ARRAY('action_key'), 'not', JSON_OBJECT('required', JSON_ARRAY('tool_key'))),
           JSON_OBJECT('required', JSON_ARRAY('tool_key'), 'not', JSON_OBJECT('required', JSON_ARRAY('action_key')))
         ),
         'properties', JSON_OBJECT(
           'plugin_key', JSON_OBJECT('type', 'string'),
           'action_key', JSON_OBJECT('type', 'string'),
           'tool_key', JSON_OBJECT('type', 'string'),
           'tenant_id', JSON_OBJECT('type', 'string'),
           'workspace_id', JSON_OBJECT('type', 'string'),
           'user_id', JSON_OBJECT('type', 'string'),
           'agent_id', JSON_OBJECT('type', 'string'),
           'requested_credential_scope', JSON_OBJECT(
             'type', 'string',
             'enum', JSON_ARRAY('user_connection', 'tenant_connection', 'platform_managed', 'device_connector', 'none')
           ),
           'target_resource_type', JSON_OBJECT('type', 'string'),
           'target_resource_uri', JSON_OBJECT('type', 'string'),
           'target_mode', JSON_OBJECT(
             'type', 'string',
             'enum', JSON_ARRAY('read_only', 'diagnostic', 'comment', 'label', 'close', 'patch', 'merge', 'apply', 'admin')
           )
         )
       )
 WHERE `tool_key` = 'platform_plugin_resolve';

UPDATE `tenant_platform_endpoint_tools`
   SET `input_schema` = JSON_OBJECT(
         'type', 'object',
         'required', JSON_ARRAY('plugin_key'),
         'additionalProperties', false,
         'oneOf', JSON_ARRAY(
           JSON_OBJECT('required', JSON_ARRAY('action_key'), 'not', JSON_OBJECT('required', JSON_ARRAY('tool_key'))),
           JSON_OBJECT('required', JSON_ARRAY('tool_key'), 'not', JSON_OBJECT('required', JSON_ARRAY('action_key')))
         ),
         'properties', JSON_OBJECT(
           'plugin_key', JSON_OBJECT('type', 'string'),
           'action_key', JSON_OBJECT('type', 'string'),
           'tool_key', JSON_OBJECT('type', 'string'),
           'agent_id', JSON_OBJECT('type', 'string'),
           'requested_credential_scope', JSON_OBJECT(
             'type', 'string',
             'enum', JSON_ARRAY('user_connection', 'tenant_connection', 'platform_managed', 'device_connector', 'none')
           ),
           'target_resource_type', JSON_OBJECT('type', 'string'),
           'target_resource_uri', JSON_OBJECT('type', 'string'),
           'target_mode', JSON_OBJECT(
             'type', 'string',
             'enum', JSON_ARRAY('read_only', 'diagnostic', 'comment', 'label', 'close', 'patch', 'merge', 'apply', 'admin')
           )
         )
       )
 WHERE `tool_key` = 'tenant_platform_plugin_resolve';
