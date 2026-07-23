-- Register governed admin tool for no-delivery auth email outbox cleanup.
-- Additive registry-only migration. It does not send email and does not change outbox rows.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'auth_email_outbox_skip_ineligible',
  'Auth Email Outbox Skip Ineligible',
  'Mark queued support-ticket admin auth email outbox notifications as skipped when they are ineligible for delivery. This tool never sends email.',
  'POST',
  '/admin/support/tickets/auth-email-outbox/skip-ineligible',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'purposes',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,email,outbox,mutation,no_delivery,cleanup,no_secrets',
  1,
  473
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order);
