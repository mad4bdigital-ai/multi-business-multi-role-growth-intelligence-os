-- Sprint 68: Ticket External Send Execution Adapter
-- Registers admin-only tools for dry-run execution planning and record-only external send execution attempts.
-- No external email/webhook send is performed by this slice.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_send_execution_plan',
  'Support Ticket External Send Execution Plan',
  'Build a dry-run external send execution plan for email/webhook, validating approval hold, credential binding, rate-limit, and retry policy without sending externally.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-send/execution-plan',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'credential_ref',JSON_OBJECT('type','string'),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_send,execution_plan,dry_run,approval_required,credential_policy,rate_limit,no_external_send,no_secrets',
  1,
  470
),
(
  'support_ticket_external_send_execution_record',
  'Support Ticket External Send Execution Record',
  'Record an external send execution attempt only after approved hold, credential binding, rate-limit, and retry policy pass. This does not send email/webhook externally.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-send/execution-record',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'credential_ref',JSON_OBJECT('type','string'),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record')),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_send,execution_record,record_only,approval_required,credential_policy,rate_limit,no_external_send,no_secrets',
  1,
  471
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
