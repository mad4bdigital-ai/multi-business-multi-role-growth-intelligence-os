-- Sprint 65: expose smoke certification lifecycle controls in tool schema.

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = '{"type":"object","required":["execution_log_id"],"properties":{"execution_log_id":{"type":"integer"},"certification_id":{"type":"string"},"certified_by":{"type":"string"},"admin_user_id":{"type":"string"},"notes":{"type":"string"},"certification_ttl_days":{"type":"integer","minimum":1,"maximum":365,"default":90}},"additionalProperties":false}',
       `description` = 'Create or update a Platform Plugin smoke certification from a successful guarded provider_smoke execution log. Requires GET, status 200, expected origin match, secrets_included=false, and records certification expiry/recertification lifecycle metadata.'
 WHERE `tool_key` = 'platform_plugin_smoke_certify';

UPDATE `admin_platform_endpoint_tools`
   SET `description` = 'Read Platform Plugin smoke certification status by plugin/action/mock provider/resource. Returns safe metadata, expiry, recertification state, and execution log references only.'
 WHERE `tool_key` = 'platform_plugin_smoke_certification_status';
