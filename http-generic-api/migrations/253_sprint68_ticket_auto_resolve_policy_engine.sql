-- Sprint 68: Backend AI Auto-Resolve Policy Engine
-- Registers admin-only tools to list auto-resolve candidates and propose backend-agent auto-resolution plans.
-- Proposal only; no auto-apply. Execution remains gated by admin feedback/approval policy.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_auto_resolve_candidates',
  'Support Ticket Auto Resolve Candidates',
  'List support tickets eligible for backend AI auto-resolution proposals under registered policy. Read-only candidate evaluation.',
  'GET',
  '/admin/support/tickets/auto-resolve/candidates',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tenant_id',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200),
      'include_ineligible',JSON_OBJECT('type','boolean')
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,auto_resolve,backend_ai,policy,candidates,read_only,no_secrets',
  1,
  459
),
(
  'support_ticket_auto_resolve_propose',
  'Support Ticket Auto Resolve Propose',
  'Record a backend AI auto-resolution proposal for a support ticket. Does not execute remediation; admin approval remains required before apply.',
  'POST',
  '/admin/support/tickets/{ticket_id}/auto-resolve/propose',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'force',JSON_OBJECT('type','boolean'),
      'summary',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('ticket_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,auto_resolve,backend_ai,policy,proposal,activation,feedback_required,mutation,no_secrets',
  1,
  460
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
