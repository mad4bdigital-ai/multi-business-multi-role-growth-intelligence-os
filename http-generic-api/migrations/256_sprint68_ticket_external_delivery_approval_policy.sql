-- Sprint 68: Ticket External Delivery Approval and Credential Policy
-- Registers admin-only tools for external delivery readiness, approval request, and approval decision.
-- No external email/webhook send is performed by this slice.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_delivery_readiness',
  'Support Ticket External Delivery Readiness',
  'Check readiness for future external email/webhook delivery: validates ticket, external channel, audience, and credential binding presence without exposing secrets or sending externally.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-delivery/readiness',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'credential_ref',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_delivery,readiness,credential_policy,no_external_send,no_secrets',
  1,
  467
),
(
  'support_ticket_external_delivery_approval_request',
  'Support Ticket External Delivery Approval Request',
  'Request an approval hold for future external notification delivery. This records approval intent only and does not perform external delivery.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-delivery/approval/request',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'credential_ref',JSON_OBJECT('type','string'),
      'preview_subject',JSON_OBJECT('type','string'),
      'preview_body',JSON_OBJECT('type','string'),
      'subject',JSON_OBJECT('type','string'),
      'body',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_delivery,approval_hold,credential_policy,no_external_send,no_secrets',
  1,
  468
),
(
  'support_ticket_external_delivery_approval_decision',
  'Support Ticket External Delivery Approval Decision',
  'Approve or reject an external delivery approval hold. Approval records policy decision only; it does not send email/webhook by itself.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-delivery/approval/decision',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approved','rejected')),
      'decision_note',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','approval_hold_id','decision'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_delivery,approval_decision,credential_policy,no_external_send,no_secrets',
  1,
  469
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
