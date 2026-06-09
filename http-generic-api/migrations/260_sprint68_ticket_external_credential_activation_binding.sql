-- Sprint 68: Ticket External Credential Validation + Binding Activation
-- Registers admin-only tools to dry-run credential activation readiness and activate+bind validated secret refs.
-- Activation requires an approved credential intake/binding hold and validation evidence.
-- No raw secret values are accepted or stored. No external email/webhook send is performed.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_credential_activation_plan',
  'Support Ticket External Credential Activation Plan',
  'Dry-run readiness for activating a pending external delivery secret reference and binding it to a support ticket/channel/audience.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-credential/activation-plan',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ref_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'validation_evidence',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id','ref_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_credential,activation_plan,dry_run,approved_hold_required,validated_only,no_raw_secrets,no_external_send,no_secrets',
  1,
  478
),
(
  'support_ticket_external_credential_activate_and_bind',
  'Support Ticket External Credential Activate And Bind',
  'Activate a pending external delivery secret reference and create an approved ticket credential binding after approved intake/binding hold and validation evidence readback pass.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-credential/activate-and-bind',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ref_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'validation_evidence',JSON_OBJECT('type','object'),
      'decision_note',JSON_OBJECT('type','string'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','activate_and_bind'))
    ),
    'required',JSON_ARRAY('ticket_id','ref_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_credential,activate_and_bind,approved_hold_required,validated_only,readback,no_raw_secrets,no_external_send,no_secrets',
  1,
  479
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
