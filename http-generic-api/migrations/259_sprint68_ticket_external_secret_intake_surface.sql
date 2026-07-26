-- Sprint 68: Ticket External Secret Intake Surface
-- Registers admin-only tools to plan, register, and activate safe external delivery secret references.
-- No raw secret values are accepted or stored. References are env/vault/external pointers only.
-- Registered references are disabled/pending_validation until an approved intake/binding hold and validation evidence activate them.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_external_secret_intake_plan',
  'Support Ticket External Secret Intake Plan',
  'Dry-run a safe external delivery secret reference intake plan. No raw secret values are accepted or stored.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-secret/intake-plan',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'store_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('env','vault','external')),
      'owner_type',JSON_OBJECT('type','string'),
      'owner_id',JSON_OBJECT('type','string'),
      'provider_family',JSON_OBJECT('type','string'),
      'credential_type',JSON_OBJECT('type','string'),
      'env_var_name',JSON_OBJECT('type','string'),
      'vault_path',JSON_OBJECT('type','string'),
      'external_ref',JSON_OBJECT('type','string'),
      'description',JSON_OBJECT('type','string'),
      'scope_json',JSON_OBJECT('type','object'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id','channel','store_type'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_secret,intake_plan,dry_run,no_raw_secrets,no_external_send,no_secrets',
  1,
  475
),
(
  'support_ticket_external_secret_reference_register',
  'Support Ticket External Secret Reference Register',
  'Register a disabled/pending-validation external delivery secret reference backed by env/vault/external pointer. Does not accept raw secret values.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-secret/reference/register',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook')),
      'store_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('env','vault','external')),
      'owner_type',JSON_OBJECT('type','string'),
      'owner_id',JSON_OBJECT('type','string'),
      'provider_family',JSON_OBJECT('type','string'),
      'credential_type',JSON_OBJECT('type','string'),
      'env_var_name',JSON_OBJECT('type','string'),
      'vault_path',JSON_OBJECT('type','string'),
      'external_ref',JSON_OBJECT('type','string'),
      'description',JSON_OBJECT('type','string'),
      'scope_json',JSON_OBJECT('type','object'),
      'evidence_json',JSON_OBJECT('type','object'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','register'))
    ),
    'required',JSON_ARRAY('ticket_id','channel','store_type'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_secret,reference_register,disabled_pending_validation,no_raw_secrets,no_external_send,no_secrets',
  1,
  476
),
(
  'support_ticket_external_secret_reference_activate',
  'Support Ticket External Secret Reference Activate',
  'Activate a previously registered external delivery secret reference only after approved credential intake/binding hold and validation evidence. No raw secret values are accepted.',
  'POST',
  '/admin/support/tickets/{ticket_id}/external-secret/reference/activate',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'ref_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'validation_evidence',JSON_OBJECT('type','object'),
      'decision_note',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','ref_id','approval_hold_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,notification,external_secret,reference_activate,approved_hold_required,validated_only,no_raw_secrets,no_external_send,no_secrets',
  1,
  477
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
