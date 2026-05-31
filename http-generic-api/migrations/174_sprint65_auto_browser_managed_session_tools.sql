-- Sprint 65: Auto Browser managed visual takeover session tools
-- Registers resource-oriented managed session contract. These tools create/read/close
-- governed pending sessions; they do not expose raw noVNC and do not execute browser
-- actions until the managed gateway and adapter are validated.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, input_schema, tags, is_enabled, sort_order)
VALUES
  (
    'browser_runtime_visual_takeover_session_create',
    'Create Managed Visual Takeover Session',
    'Create a governed Auto Browser visual takeover session request using the planned managed runtime binding. Returns a pending adapter/gateway session; raw noVNC exposure is forbidden and secrets are never returned.',
    'POST',
    '/browser-runtime/visual-takeover/sessions',
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_url'),
      'properties',JSON_OBJECT(
        'target_url',JSON_OBJECT('type','string'),
        'url',JSON_OBJECT('type','string'),
        'binding_key',JSON_OBJECT('type','string','default','auto_browser_managed_visual_takeover_v1'),
        'runtime_key',JSON_OBJECT('type','string','default','auto_browser_managed_v1'),
        'tenant_id',JSON_OBJECT('type','string'),
        'user_id',JSON_OBJECT('type','string'),
        'request_key',JSON_OBJECT('type','string'),
        'ttl_seconds',JSON_OBJECT('type','integer','minimum',60,'maximum',14400,'default',1800),
        'explicit_approval',JSON_OBJECT('type','boolean','default',true),
        'approved',JSON_OBJECT('type','boolean'),
        'actor',JSON_OBJECT('type','string'),
        'requested_by',JSON_OBJECT('type','string'),
        'allowed_domains',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
        'domain_allowlist',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'))
      ),
      'additionalProperties',false
    ),
    'browser-runtime,auto-browser,visual-takeover,managed,gateway_pending,state_changing,no_secrets,admin',
    1,
    374
  ),
  (
    'browser_runtime_visual_takeover_session_get',
    'Get Managed Visual Takeover Session',
    'Read a governed browser runtime session by session_id. Returns sanitized metadata only and never returns secrets.',
    'GET',
    '/browser-runtime/visual-takeover/sessions/{session_id}',
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('session_id'),
      'properties',JSON_OBJECT('session_id',JSON_OBJECT('type','string')),
      'additionalProperties',false
    ),
    'browser-runtime,auto-browser,visual-takeover,managed,read_only,no_secrets,admin',
    1,
    375
  ),
  (
    'browser_runtime_visual_takeover_session_close',
    'Close Managed Visual Takeover Session',
    'Close a governed browser runtime session. Before adapter validation this records closed_pending_adapter and emits an audited close event; secrets are never returned.',
    'POST',
    '/browser-runtime/visual-takeover/sessions/{session_id}/close',
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('session_id'),
      'properties',JSON_OBJECT(
        'session_id',JSON_OBJECT('type','string'),
        'actor',JSON_OBJECT('type','string'),
        'requested_by',JSON_OBJECT('type','string'),
        'reason',JSON_OBJECT('type','string','default','manual_close')
      ),
      'additionalProperties',false
    ),
    'browser-runtime,auto-browser,visual-takeover,managed,state_changing,no_secrets,admin',
    1,
    376
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
