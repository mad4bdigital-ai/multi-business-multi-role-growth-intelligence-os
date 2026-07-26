-- Sprint 68: Ticket Lifecycle Authority trusted brand_ref resolution
-- Registers admin-only read-only tool to resolve trusted brand_ref candidates before remediation.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_resolve_brand_refs',
  'Support Ticket Resolve Brand Refs',
  'Resolve trusted brand_ref candidates for a support ticket using effective grants, workspace assets, workspace registry, and legacy brand registry evidence before remediation.',
  'POST',
  '/admin/support/tickets/{ticket_id}/brand-ref-resolution',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'user_id',JSON_OBJECT('type','string'),
      'brand_ref',JSON_OBJECT('type','string'),
      'brand_refs',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'min_confidence',JSON_OBJECT('type','integer','minimum',0,'maximum',100),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50)
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,brand_ref_resolution,workspace_resource_grants,workspace_assets,workspace_registry,read_only,no_secrets',
  1,
  449
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
