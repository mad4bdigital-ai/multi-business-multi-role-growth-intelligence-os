-- Sprint 68: Ticket Lifecycle Authority reconciliation tool
-- Registers the admin-only reconciliation endpoint for classifying existing open tickets.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_reconcile',
  'Support Ticket Reconcile',
  'Dry-run or apply lifecycle classification for existing open support tickets using governed ticket authority rules and real ticket evidence.',
  'POST',
  '/admin/support/tickets/reconcile',
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
  'admin,support,tickets,lifecycle,reconciliation,dry_run,mutation,no_secrets',
  1,
  435
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
