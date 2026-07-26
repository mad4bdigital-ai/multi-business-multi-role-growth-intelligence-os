-- Sprint 68: Ticket Lifecycle Authority verified apply rollback
-- Registers admin-only dry-run/apply tool for brand mapping remediation with pre/post snapshots and readback verification.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_verified_brand_mapping_apply',
  'Support Ticket Verified Brand Mapping Apply',
  'Dry-run or apply brand mapping remediation with pre-apply snapshot, post-apply readback against v_workspace_resource_grant_effective, and rollback on failed verification.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-mapping-remediation/verified-apply',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'approval_hold_id',JSON_OBJECT('type','string'),
      'remediation_approval_hold_id',JSON_OBJECT('type','string'),
      'brand_ref',JSON_OBJECT('type','string'),
      'brand_refs',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'permission',JSON_OBJECT('type','string','enum',JSON_ARRAY('owner','admin','manage','operate','edit','comment','view')),
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply')),
      'rollback_on_failed_verification',JSON_OBJECT('type','boolean'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_mapping,verified_apply,rollback,workspace_resource_grants,readback,dry_run_first,lifecycle,mutation,no_secrets',
  1,
  455
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
