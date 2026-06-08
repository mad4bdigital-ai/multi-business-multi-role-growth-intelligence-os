-- Sprint 68: Ticket Lifecycle Authority manual brand_ref selection
-- Registers admin-only tools to request and approve manual brand_ref selection when resolver has no trusted selected brand_ref.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_request_brand_ref_selection',
  'Support Ticket Request Brand Ref Selection',
  'Create or reuse a brand_ref selection approval hold for a support ticket when resolver evidence has no single trusted selected brand_ref.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-ref-selection/request',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'min_confidence',JSON_OBJECT('type','integer','minimum',0,'maximum',100),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50),
      'required_role',JSON_OBJECT('type','string'),
      'assigned_to',JSON_OBJECT('type','string'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_ref_selection,approval_holds,brand_ref_resolution,lifecycle,mutation,no_secrets',
  1,
  450
),
(
  'support_ticket_approve_brand_ref_selection',
  'Support Ticket Approve Brand Ref Selection',
  'Approve a manual brand_ref selection hold by storing selected_brand_ref as structured decision evidence before remediation.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-ref-selection/approve',
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
  'admin,support,tickets,brand_ref_selection,approval_holds,lifecycle,mutation,no_secrets',
  1,
  451
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
