-- Sprint 68: Ticket Lifecycle Authority execution plans
-- Registers admin-only tool to create an execution plan from a support ticket.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'support_ticket_create_execution_plan',
  'Support Ticket Create Execution Plan',
  'Create a governed execution plan from a support ticket using ticket type templates and link it back into the ticket lifecycle ledger.',
  'POST',
  '/admin/support/tickets/{ticket_id}/execution-plan',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'workflow_key',JSON_OBJECT('type','string'),
      'intent_key',JSON_OBJECT('type','string'),
      'target_key',JSON_OBJECT('type','string'),
      'route_key',JSON_OBJECT('type','string'),
      'service_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('self_serve','assisted','managed')),
      'access_decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('ALLOW_SELF_SERVE','ALLOW_WITH_OPTIONAL_ASSISTANCE','REQUIRE_REVIEW','REQUIRE_SUPERVISOR_APPROVAL','ROUTE_TO_MANAGED_SERVICE','DENY')),
      'steps_json',JSON_OBJECT('type','array'),
      'preview_json',JSON_OBJECT('type','object'),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,execution_plans,workflow_links,lifecycle,mutation,no_secrets',
  1,
  439
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
