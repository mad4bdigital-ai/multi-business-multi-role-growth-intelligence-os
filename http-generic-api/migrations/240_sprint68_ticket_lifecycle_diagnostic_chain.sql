-- Sprint 68: Ticket Lifecycle Authority diagnostic chain
-- Registers admin-only tool to run pending diagnostic step_runs and create remediation approval when evidence requires mapping review.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_run_diagnostic_chain',
  'Support Ticket Run Diagnostic Chain',
  'Run a governed diagnostic chain for a support ticket workflow run, executing pending diagnostic step_runs and creating remediation approval when evidence requires mapping review.',
  'POST',
  '/admin/support/tickets/{ticket_id}/diagnostic-chain',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'max_steps',JSON_OBJECT('type','integer','minimum',1,'maximum',25),
      'create_remediation_hold',JSON_OBJECT('type','boolean'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,diagnostic_chain,step_runs,approval_holds,lifecycle,mutation,no_secrets',
  1,
  445
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
