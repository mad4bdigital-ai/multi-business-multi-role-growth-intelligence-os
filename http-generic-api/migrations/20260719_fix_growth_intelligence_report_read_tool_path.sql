-- Correct the registered path for the existing read-only Growth Intelligence report tool.
-- Guarded and idempotent: updates only the one tool row when path metadata differs.
-- No schema change, provider call, external send, approval decision, execution dispatch, or secret read.

UPDATE admin_platform_endpoint_tools
   SET http_path = '/tenants/{tenant_id}/growth-intelligence/reports/{report_id}',
       path_param_keys = JSON_ARRAY('tenant_id', 'report_id'),
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'growth_intelligence_report_read'
   AND http_method = 'GET'
   AND (
     http_path <> '/tenants/{tenant_id}/growth-intelligence/reports/{report_id}'
     OR JSON_LENGTH(path_param_keys) <> 2
     OR JSON_UNQUOTE(JSON_EXTRACT(path_param_keys, '$[0]')) <> 'tenant_id'
     OR JSON_UNQUOTE(JSON_EXTRACT(path_param_keys, '$[1]')) <> 'report_id'
   );
