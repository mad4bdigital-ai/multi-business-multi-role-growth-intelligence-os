-- Sprint 68: Ticket External Credential Intake Activation Orchestration
-- Registers admin-only tools to plan and run approve-intake + activate-ref + bind + readiness-verify flow.
-- No raw secret values are accepted or stored. No external email/webhook send is performed.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_credential_orchestration_plan',
  'Support Ticket External Credential Orchestration Plan',
  'Dry-run the approved intake/binding hold decision, credential activation, ticket binding, and readiness verification plan for external delivery credentials.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-credential/orchestration-plan',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ref_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approve_first',JSON_OBJECT('type','boolean'),
      'validation_evidence',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id','ref_id','approval_hold_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_credential,orchestration_plan,dry_run,approved_hold_required,validated_only,no_raw_secrets,no_external_send,no_secrets',
  1,
  480
),
(
  'support_ticket_external_credential_approve_activate_bind_verify',
  'Support Ticket External Credential Approve Activate Bind Verify',
  'Approve an open credential intake/binding hold, activate a pending external secret reference, create an approved ticket binding, and verify readiness. No external delivery is sent.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-credential/approve-activate-bind-verify',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ref_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both')),
      'approve_first',JSON_OBJECT('type','boolean'),
      'validation_evidence',JSON_OBJECT('type','object'),
      'decision_note',JSON_OBJECT('type','string'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','approve_activate_bind_verify'))
    ),
    'required',JSON_ARRAY('ticket_id','ref_id','approval_hold_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_credential,approve_activate_bind_verify,transactional,readback,approved_hold_required,no_raw_secrets,no_external_send,no_secrets',
  1,
  481
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
