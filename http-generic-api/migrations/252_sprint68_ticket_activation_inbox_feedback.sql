-- Sprint 68: Activation-gated Ticket Operations inbox and admin feedback loop
-- Registers admin-only tools for activation ticket inbox and admin feedback decisions.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_activation_inbox',
  'Support Ticket Activation Inbox',
  'Return activation-gated ticket inbox buckets for admin activation: awaiting activation, needs approval, auto-resolve candidates, blocked, recently resolved, and admin acknowledgments.',
  'GET',
  '/admin/activation/ticket-inbox',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tenant_id',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200),
      'include_resolved_days',JSON_OBJECT('type','integer','minimum',1,'maximum',30)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,activation,inbox,feedback,read_only,no_secrets',
  1,
  457
),
(
  'support_ticket_admin_feedback',
  'Support Ticket Admin Feedback',
  'Record an admin feedback decision for an activation-gated ticket: acknowledge, mark activation seen, approve/reject auto-resolve, request more info, or assign queue.',
  'POST',
  '/admin/support/tickets/{ticket_id}/admin-feedback',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'feedback_action',JSON_OBJECT('type','string','enum',JSON_ARRAY('acknowledge','mark_activation_seen','approve_auto_resolve','reject_auto_resolve','request_more_info','assign_to_queue')),
      'decision',JSON_OBJECT('type','string'),
      'summary',JSON_OBJECT('type','string'),
      'queue_key',JSON_OBJECT('type','string'),
      'assigned_to',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id','feedback_action'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,activation,feedback,lifecycle,mutation,no_secrets',
  1,
  458
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
