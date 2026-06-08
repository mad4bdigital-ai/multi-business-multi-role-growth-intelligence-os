-- Sprint 68: Ticket Lifecycle Authority brand mapping remediation
-- Registers admin-only tool to apply approved brand grant remediation for support tickets.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_apply_brand_mapping_remediation',
  'Support Ticket Apply Brand Mapping Remediation',
  'Apply approved brand mapping remediation for a support ticket by creating active workspace_resource_grants, then verify through v_workspace_resource_grant_effective.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-mapping-remediation',
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
      'dry_run',JSON_OBJECT('type','boolean'),
      'reason',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_mapping,workspace_resource_grants,approval_holds,lifecycle,mutation,no_secrets',
  1,
  446
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
