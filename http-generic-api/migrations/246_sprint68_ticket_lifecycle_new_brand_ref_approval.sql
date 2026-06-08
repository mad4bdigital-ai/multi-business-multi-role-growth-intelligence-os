-- Sprint 68: Ticket Lifecycle Authority new brand_ref approval
-- Registers admin-only tools to request/approve explicit new brand_ref authorization before allow_new_ref remediation apply.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_request_new_brand_ref_approval',
  'Support Ticket Request New Brand Ref Approval',
  'Create or reuse a new_brand_ref_approval hold for a support ticket before allow_new_ref remediation apply can proceed.',
  'POST',
  '/admin/support/tickets/{ticket_id}/new-brand-ref-approval/request',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'selected_brand_ref',JSON_OBJECT('type','string'),
      'allow_new_ref',JSON_OBJECT('type','boolean'),
      'required_role',JSON_OBJECT('type','string'),
      'assigned_to',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','selected_brand_ref'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,new_brand_ref_approval,brand_mapping,approval_holds,lifecycle,mutation,no_secrets',
  1,
  453
),
(
  'support_ticket_approve_new_brand_ref',
  'Support Ticket Approve New Brand Ref',
  'Approve a new_brand_ref_approval hold for the selected brand_ref so allow_new_ref remediation apply can proceed.',
  'POST',
  '/admin/support/tickets/{ticket_id}/new-brand-ref-approval/approve',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'selected_brand_ref',JSON_OBJECT('type','string'),
      'allow_new_ref',JSON_OBJECT('type','boolean'),
      'decision_note',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','selected_brand_ref'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,new_brand_ref_approval,approval_holds,lifecycle,mutation,no_secrets',
  1,
  454
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
