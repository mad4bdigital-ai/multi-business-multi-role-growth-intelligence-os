-- Sprint 67: OpenRouter provider live smoke tool registration.
-- Scope: admin tool registry only. No credential values are stored here.
-- The shell alias reads platform_secret:openrouter_api_key server-side and
-- returns metadata-only smoke evidence with secrets_included=false.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'openrouter_provider_smoke',
  'OpenRouter Provider Live Smoke',
  'Run a bounded live OpenRouter chat-completions smoke through the platform-managed secret binding. Returns metadata only, never the API key. Promotion to active requires explicit confirmation.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','openrouter_provider_smoke'),
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string'),
        'maxItems',8,
        'description','Optional flags: --model openai/gpt-4o-mini, --max-tokens 8, --promote-active, --confirm PROMOTE_OPENROUTER_PROVIDER_ACTIVE_AFTER_LIVE_SMOKE'
      )
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,ai_model_provider,openrouter,live_smoke,no_secrets,platform_secret,requires_confirmation_for_active,bounded_cost,provider_dispatch',
  1,
  227
)
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
  sort_order = VALUES(sort_order);
