-- Sprint 66: Tenant SSH CLI execute job result tool
-- Registers tenant-safe polling for async SSH CLI execution jobs. Results are
-- scoped to the requesting user, tenant, and connection; worker payloads and
-- responses never expose SSH private keys.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_ssh_cli_execute_job_result',
  'Tenant SSH CLI Execute Job Result',
  'Read the result of a tenant SSH CLI allowlisted execute job. Scoped by tenant user and connection; returns redacted output only and never returns credentials.',
  'GET',
  '/me/infrastructure/ssh/connections/{connection_id}/cli/execute-jobs/{job_id}/result',
  JSON_ARRAY('connection_id','job_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id','job_id'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'job_id',JSON_OBJECT('type','string')
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,execute,job_result,async_worker,read_only,no_secrets,output_capped,auth_scoped,specific_path',
  1,
  332
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
