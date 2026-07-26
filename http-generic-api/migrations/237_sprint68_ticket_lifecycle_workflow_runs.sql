-- Sprint 68: Ticket Lifecycle Authority workflow runs and status propagation
-- Registers admin-only tools to create workflow runs from ticket execution plans and sync runtime status back to tickets.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_create_workflow_run',
  'Support Ticket Create Workflow Run',
  'Create a workflow run from a support ticket execution plan and link it back into the ticket lifecycle ledger.',
  'POST',
  '/admin/support/tickets/{ticket_id}/workflow-run',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('pending','running','awaiting_approval','awaiting_review','paused')),
      'current_step',JSON_OBJECT('type','string'),
      'input_json',JSON_OBJECT('type','object'),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,workflow_runs,execution_plans,lifecycle,mutation,no_secrets',
  1,
  440
),
(
  'support_ticket_runtime_sync',
  'Support Ticket Runtime Sync',
  'Synchronize workflow run, execution plan, or approval hold status back to a support ticket lifecycle state.',
  'POST',
  '/admin/support/tickets/{ticket_id}/runtime-sync',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,workflow_runs,execution_plans,approval_holds,lifecycle,mutation,no_secrets',
  1,
  441
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
