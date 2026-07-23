-- Add explicit mutation governance tags for the no-delivery auth email outbox cleanup tool.
-- Registry-only update. Does not send email and does not mutate auth_email_outbox rows.

UPDATE admin_platform_endpoint_tools
   SET tags = 'admin,support,tickets,email,outbox,mutation,no_delivery,cleanup,approval_required,readback,same_cycle_readback,no_secrets'
 WHERE tool_key = 'auth_email_outbox_skip_ineligible'
   AND http_path = '/admin/support/tickets/auth-email-outbox/skip-ineligible'
   AND tags NOT LIKE '%approval_required%';
