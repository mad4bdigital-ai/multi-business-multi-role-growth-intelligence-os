-- Sprint 68: additive tenant-ticket simulation support and Admin GPT repair-link state.
-- This does not replace /me/support/tickets. It adds an admin-only route-equivalent simulation tool
-- and stores the canonical Admin GPT URL used in external-delivery approval payloads.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note, created_at, updated_at)
VALUES
  ('support_ticket.admin_gpt_repair_link',
   JSON_OBJECT(
     'base_url', 'https://chatgpt.com/g/g-69c82c73bd6081918c52e38525b2d154-growth-intelligence-platform-admin-assistant/',
     'prompt_parameter', 'prompt',
     'purpose', 'Open Admin GPT with support-ticket repair state embedded as a prompt parameter.',
     'support_additive_only', true,
     'secrets_included', false
   ),
   'active',
   'Canonical Admin GPT repair link base URL for Support Ticket external-delivery approval requests.',
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('support_ticket_tenant_user_create_simulation',
   'Create Support Ticket as Tenant User Simulation',
   'Admin-only additive support tool that exercises the same tenantTicketEnvelope + createOrAppendSupportTicket path as POST /me/support/tickets for a selected active tenant member. It does not replace the real tenant route and does not perform external sends.',
   'POST',
   '/admin/support/tickets/tenant-user/create-simulation',
   JSON_ARRAY(),
   JSON_OBJECT(
     'type', 'object',
     'required', JSON_ARRAY('tenant_id','user_id','title','customer_message'),
     'additionalProperties', true,
     'properties', JSON_OBJECT(
       'tenant_id', JSON_OBJECT('type','string'),
       'user_id', JSON_OBJECT('type','string'),
       'title', JSON_OBJECT('type','string'),
       'customer_message', JSON_OBJECT('type','string'),
       'ticket_type', JSON_OBJECT('type','string'),
       'source_event', JSON_OBJECT('type','string'),
       'priority', JSON_OBJECT('type','string'),
       'severity', JSON_OBJECT('type','string'),
       'category', JSON_OBJECT('type','string'),
       'resource_type', JSON_OBJECT('type','string'),
       'resource_ref', JSON_OBJECT('type','string'),
       'metadata_json', JSON_OBJECT('type','object','additionalProperties',true)
     )
   ),
   JSON_OBJECT(),
   'support-ticket,admin,tenant-simulation,additive,no-external-send',
   1,
   689,
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;
