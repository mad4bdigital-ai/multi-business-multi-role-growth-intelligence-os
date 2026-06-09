-- Sprint 68: Ticket Notification Delivery Adapters
-- Registers admin-only tools for adapter discovery, delivery preview, and guarded record-only dispatch.
-- Email/webhook external sending remains gated; these tools do not perform external delivery.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_notification_adapters',
  'Support Ticket Notification Adapters',
  'List available support ticket notification delivery adapters and their external-send capabilities.',
  'GET',
  '/admin/support/tickets/notifications/adapters',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',false),
  NULL,
  'admin,support,tickets,notification,adapters,delivery,read_only,no_external_send,no_secrets',
  1,
  464
),
(
  'support_ticket_notification_delivery_preview',
  'Support Ticket Notification Delivery Preview',
  'Preview a support ticket notification delivery payload for a selected adapter. Dry-run only; no external send.',
  'POST',
  '/admin/support/tickets/{ticket_id}/notification-delivery/preview',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('activation_inbox','dashboard','internal_timeline','email','webhook')),
      'notification_type',JSON_OBJECT('type','string'),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,delivery,preview,dry_run,no_external_send,no_secrets',
  1,
  465
),
(
  'support_ticket_notification_delivery_dispatch',
  'Support Ticket Notification Delivery Dispatch',
  'Dispatch a support ticket notification through a guarded adapter. Current supported dispatch is record-only internal delivery; email/webhook are gated.',
  'POST',
  '/admin/support/tickets/{ticket_id}/notification-delivery/dispatch',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('activation_inbox','dashboard','internal_timeline','email','webhook')),
      'notification_type',JSON_OBJECT('type','string'),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record','dispatch')),
      'delivery_approval_hold_id',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,delivery,adapter_dispatch,record_only,gated_external,no_external_send,no_secrets',
  1,
  466
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
