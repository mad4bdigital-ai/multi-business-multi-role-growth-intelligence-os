-- Sprint 68: Ticket External Delivery Credential Intake and Binding
-- Registers admin-only tools to list safe credential candidates, request credential binding/intake approval, and decide binding holds.
-- No raw secret values are accepted or exposed; bindings reference existing credential refs only.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_credential_candidates',
  'Support Ticket External Credential Candidates',
  'List safe credential references that may be bound to external email/webhook delivery. Read-only; never returns secret values.',
  'GET',
  '/admin/support/tickets/external-delivery/credential-candidates',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_delivery,credential_candidates,read_only,no_raw_secrets,no_secrets',
  1,
  472
),
(
  'support_ticket_external_credential_binding_request',
  'Support Ticket External Credential Binding Request',
  'Request approval to bind an existing credential reference to a support ticket external delivery channel, or request credential intake when no ref exists.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-delivery/credential-binding/request',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'credential_ref',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_delivery,credential_binding,approval_hold,no_raw_secrets,no_external_send,no_secrets',
  1,
  473
),
(
  'support_ticket_external_credential_binding_decision',
  'Support Ticket External Credential Binding Decision',
  'Approve or reject an external delivery credential binding/intake hold. Approval only binds an existing active credential reference; no raw secrets are stored.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-delivery/credential-binding/decision',
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
  'admin,support,tickets,notification,external_delivery,credential_binding,approval_decision,no_raw_secrets,no_external_send,no_secrets',
  1,
  474
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
