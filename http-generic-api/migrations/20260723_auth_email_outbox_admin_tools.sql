-- Register governed admin tools for auth email outbox status, dry-run, and gated apply.
-- Additive registry-only migration. No delivery is executed by this migration.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'auth_email_outbox_status',
  'Auth Email Outbox Status',
  'Read grouped status counts for support-ticket admin auth email outbox notifications.',
  'GET',
  '/admin/support/tickets/auth-email-outbox/status',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'purposes',JSON_OBJECT('type','string')
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,email,outbox,read_only,no_secrets',
  1,
  470
),
(
  'auth_email_outbox_dry_run',
  'Auth Email Outbox Dry Run',
  'Preview eligible and skipped support-ticket admin auth email outbox notifications without sending.',
  'POST',
  '/admin/support/tickets/auth-email-outbox/dry-run',
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
  'admin,support,tickets,email,outbox,read_only,dry_run,no_secrets',
  1,
  471
),
(
  'auth_email_outbox_apply',
  'Auth Email Outbox Apply',
  'Run one bounded auth email outbox delivery pass. External delivery remains feature-flagged and typed-confirmation gated.',
  'POST',
  '/admin/support/tickets/auth-email-outbox/apply',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'purposes',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50),
      'confirm',JSON_OBJECT('type','string'),
      'sender_connection_id',JSON_OBJECT('type','string')
    ),
    'required',JSON_ARRAY('confirm'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,email,outbox,mutation,external_delivery,approval_required,no_secrets',
  1,
  472
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
