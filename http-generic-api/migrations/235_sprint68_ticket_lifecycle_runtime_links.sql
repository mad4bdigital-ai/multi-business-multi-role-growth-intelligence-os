-- Sprint 68: Ticket Lifecycle Authority runtime links
-- Registers admin-only ticket approval/workflow/SLA tools.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_create_approval_hold',
  'Support Ticket Create Approval Hold',
  'Create an approval hold for a support ticket and link it into the ticket lifecycle/workflow ledger.',
  'POST',
  '/admin/support/tickets/{ticket_id}/approval-hold',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'hold_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('review','supervisor_approval','managed_handoff','legal_hold')),
      'required_role',JSON_OBJECT('type','string'),
      'assigned_to',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string'),
      'expires_at',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,approval_holds,lifecycle,mutation,no_secrets',
  1,
  436
),
(
  'support_ticket_link_workflow',
  'Support Ticket Link Workflow',
  'Link a support ticket to an execution plan, workflow run, or approval hold with internal evidence.',
  'POST',
  '/admin/support/tickets/{ticket_id}/link-workflow',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'relationship',JSON_OBJECT('type','string'),
      'status',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,workflow_links,lifecycle,mutation,no_secrets',
  1,
  437
),
(
  'support_ticket_sla_reconcile',
  'Support Ticket SLA Reconcile',
  'Dry-run or apply SLA status reconciliation for open support tickets.',
  'POST',
  '/admin/support/tickets/sla/reconcile',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tenant_id',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',250),
      'apply',JSON_OBJECT('type','boolean')
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,sla,lifecycle,dry_run,mutation,no_secrets',
  1,
  438
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
