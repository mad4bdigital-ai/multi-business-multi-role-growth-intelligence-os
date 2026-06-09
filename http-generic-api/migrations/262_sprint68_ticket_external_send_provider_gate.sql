-- Sprint 68: Ticket External Send Provider Gate
-- Registers admin-only tools to plan and record blocked provider-dispatch attempts after all pre-send gates are satisfied.
-- This slice does not perform external email/webhook delivery. Provider dispatch remains disabled and adapter implementation is intentionally absent.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_send_provider_gate_plan',
  'Support Ticket External Send Provider Gate Plan',
  'Dry-run the final provider dispatch gate after execution readiness is satisfied. Does not send externally.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-send/provider-gate-plan',
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
      'provider_key',JSON_OBJECT('type','string'),
      'send_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','provider_send')),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_send,provider_gate,dry_run,provider_disabled,no_raw_secrets,no_external_send,no_secrets',
  1,
  482
),
(
  'support_ticket_external_send_provider_gate_attempt',
  'Support Ticket External Send Provider Gate Attempt',
  'Record a blocked provider dispatch attempt for audit/timeline purposes only. Does not send email/webhook externally.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-send/provider-gate-attempt',
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
      'provider_key',JSON_OBJECT('type','string'),
      'send_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','provider_send')),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record_blocked_attempt')),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'payload_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_send,provider_gate,blocked_attempt,audit_only,provider_disabled,no_raw_secrets,no_external_send,no_secrets',
  1,
  483
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
