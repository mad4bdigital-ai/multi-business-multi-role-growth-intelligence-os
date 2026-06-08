-- Sprint 68: Ticket Lifecycle Authority step runs
-- Registers admin-only tools to create step_runs from a ticket workflow run and update step outcomes.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_create_step_runs',
  'Support Ticket Create Step Runs',
  'Create step_runs from a support ticket workflow run and its execution plan steps, then link status into the ticket lifecycle.',
  'POST',
  '/admin/support/tickets/{ticket_id}/step-runs',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,step_runs,workflow_runs,lifecycle,mutation,no_secrets',
  1,
  442
),
(
  'support_ticket_update_step_run',
  'Support Ticket Update Step Run',
  'Update a support ticket step_run status and propagate the workflow/ticket lifecycle outcome.',
  'POST',
  '/admin/support/tickets/{ticket_id}/step-run',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'step_run_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'step_key',JSON_OBJECT('type','string'),
      'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('pending','running','completed','failed','skipped','awaiting')),
      'output_json',JSON_OBJECT('type','object'),
      'error_message',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','status'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,step_runs,workflow_runs,lifecycle,mutation,no_secrets',
  1,
  443
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
