-- Sprint 68: Ticket Lifecycle Authority brand_ref selection completion orchestration
-- Registers admin-only tool to dry-run/apply brand_ref selection approval and remediation completion in one governed flow.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_approve_brand_ref_selection_and_complete',
  'Support Ticket Approve Brand Ref Selection And Complete',
  'Dry-run or apply a governed flow that approves selected_brand_ref and completes brand mapping remediation using a separate remediation approval hold.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-ref-selection/approve-and-complete',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'brand_ref_selection_hold_id',JSON_OBJECT('type','string'),
      'selection_hold_id',JSON_OBJECT('type','string'),
      'remediation_approval_hold_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'selected_brand_ref',JSON_OBJECT('type','string'),
      'allow_new_ref',JSON_OBJECT('type','boolean'),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply')),
      'approve_first',JSON_OBJECT('type','boolean'),
      'close_if_verified',JSON_OBJECT('type','boolean'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','selected_brand_ref'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_ref_selection,brand_mapping,approval_holds,remediation,dry_run_first,lifecycle,mutation,no_secrets',
  1,
  452
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
