-- Sprint 68: Ticket Lifecycle Authority final brand mapping remediation orchestration
-- Registers admin-only dry-run/apply finalizer that validates approvals, performs verified apply, reruns diagnostics, and closes only when verified.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_finalize_brand_mapping_remediation',
  'Support Ticket Finalize Brand Mapping Remediation',
  'Dry-run or apply final brand mapping remediation orchestration: validate approval chain, run verified apply, rerun diagnostics, and close only after readback and diagnostic verification.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-mapping-remediation/finalize',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'selected_brand_ref',JSON_OBJECT('type','string'),
      'brand_ref',JSON_OBJECT('type','string'),
      'brand_ref_selection_hold_id',JSON_OBJECT('type','string'),
      'selection_hold_id',JSON_OBJECT('type','string'),
      'new_brand_ref_approval_hold_id',JSON_OBJECT('type','string'),
      'remediation_approval_hold_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'workflow_run_id',JSON_OBJECT('type','string'),
      'run_id',JSON_OBJECT('type','string'),
      'plan_id',JSON_OBJECT('type','string'),
      'permission',JSON_OBJECT('type','string','enum',JSON_ARRAY('owner','admin','manage','operate','edit','comment','view')),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply')),
      'close_if_verified',JSON_OBJECT('type','boolean'),
      'max_steps',JSON_OBJECT('type','integer','minimum',1,'maximum',25),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id','selected_brand_ref'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_mapping,finalize,verified_apply,diagnostic_chain,approval_holds,dry_run_first,lifecycle,mutation,no_secrets',
  1,
  456
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
