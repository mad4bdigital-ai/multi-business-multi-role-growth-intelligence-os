-- Sprint 68: Ticket Notification Delivery and Admin Approval Cycle
-- Registers admin-only tools for notification queue, notification cycle records, and delivery/ack records.
-- Record-only delivery layer: no external email/webhook send is performed by these tools.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_notification_queue',
  'Support Ticket Notification Queue',
  'List activation/admin/customer notification recommendations for support tickets. Read-only notification queue view.',
  'GET',
  '/admin/support/tickets/notifications/queue',
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
  'admin,support,tickets,notification,queue,activation,read_only,no_secrets',
  1,
  461
),
(
  'support_ticket_notification_cycle_create',
  'Support Ticket Notification Cycle Create',
  'Record a notification cycle event for a support ticket. This is record-only and does not send external email/webhook delivery.',
  'POST',
  '/admin/support/tickets/{ticket_id}/notification-cycle',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'notification_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin_activation_review','admin_auto_resolve_proposal','admin_approval_required','admin_feedback_requested','customer_resolution_update','reminder')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('activation_inbox','email','dashboard','webhook','internal_timeline')),
      'delivery_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('queued','delivered','acknowledged','dismissed','failed','snoozed','customer_notified')),
      'summary',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,cycle,delivery_record,activation,mutation,no_external_send,no_secrets',
  1,
  462
),
(
  'support_ticket_notification_ack',
  'Support Ticket Notification Ack',
  'Record notification delivery/acknowledgment status for a support ticket. Record-only; does not send external delivery.',
  'POST',
  '/admin/support/tickets/{ticket_id}/notification-ack',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ack_action',JSON_OBJECT('type','string','enum',JSON_ARRAY('queued','delivered','acknowledged','dismissed','failed','snoozed','customer_notified')),
      'notification_type',JSON_OBJECT('type','string'),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('activation_inbox','email','dashboard','webhook','internal_timeline')),
      'summary',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id','ack_action'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,ack,delivery_record,activation,mutation,no_external_send,no_secrets',
  1,
  463
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
