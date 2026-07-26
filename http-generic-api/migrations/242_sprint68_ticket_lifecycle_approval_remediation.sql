-- Sprint 68: Ticket Lifecycle Authority approval decision and remediation completion
-- Registers admin-only tools to decide approval holds and complete approved brand mapping remediation.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_decide_approval_hold',
  'Support Ticket Decide Approval Hold',
  'Record an approval hold decision for a support ticket and propagate the decision to ticket lifecycle status.',
  'POST',
  '/admin/support/tickets/{ticket_id}/approval-hold/decision',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approved','rejected','escalated','expired')),
      'decision_note',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','decision'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,approval_holds,lifecycle,mutation,no_secrets',
  1,
  447
),
(
  'support_ticket_complete_brand_mapping_remediation',
  'Support Ticket Complete Brand Mapping Remediation',
  'Approve if requested, apply brand mapping remediation, rerun verification diagnostics, and resolve the ticket when evidence verifies the mapping.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-mapping-remediation/complete',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'brand_ref',JSON_OBJECT('type','string'),
      'brand_refs',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'permission',JSON_OBJECT('type','string','enum',JSON_ARRAY('owner','admin','manage','operate','edit','comment','view')),
      'approve_first',JSON_OBJECT('type','boolean'),
      'close_if_verified',JSON_OBJECT('type','boolean'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_mapping,approval_holds,workspace_resource_grants,diagnostic_steps,lifecycle,mutation,no_secrets',
  1,
  448
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
