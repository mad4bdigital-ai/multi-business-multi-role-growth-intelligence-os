-- Sprint 68: Ticket Lifecycle Authority diagnostic step execution
-- Registers admin-only tool to execute governed diagnostic step_runs and write evidence.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_execute_diagnostic_step',
  'Support Ticket Execute Diagnostic Step',
  'Execute a governed diagnostic step_run for a support ticket, reading live platform evidence and writing sanitized output_json.',
  'POST',
  '/admin/support/tickets/{ticket_id}/step-run/execute',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'step_run_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'step_key',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,diagnostic_steps,step_runs,workflow_runs,lifecycle,mutation,no_secrets',
  1,
  444
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order);
