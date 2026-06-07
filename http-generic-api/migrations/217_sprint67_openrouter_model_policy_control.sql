-- Sprint 67: OpenRouter model selection policy control.
-- Scope: runtime config + admin tool registry. No secrets are stored.
-- This lets admins change model slugs such as openai/gpt-4o-mini without code edits.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('openrouter_model_selection_policy_v1',
   JSON_OBJECT(
     'policy_key','openrouter_model_selection_policy_v1',
     'provider_key','openrouter_openai_compatible',
     'default_model_slug','openai/gpt-4o-mini',
     'fallback_model_slug','openai/gpt-4o-mini',
     'allowed_model_slugs',JSON_ARRAY('openai/gpt-4o-mini'),
     'task_overrides',JSON_OBJECT(
       'docs_agent_writer','openai/gpt-4o-mini',
       'docs_agent_reviewer','openai/gpt-4o-mini',
       'provider_smoke','openai/gpt-4o-mini'
     ),
     'require_allowlist',true,
     'allow_runtime_override',true,
     'allow_unlisted_runtime_override',false,
     'status','active',
     'updated_by','217_sprint67_openrouter_model_policy_control',
     'secrets_included',false
   ),
   'active',
   'OpenRouter model selection policy. Controls default/fallback/task model slugs through registry; no secrets.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE ai_model_registry
   SET cost_policy_json = JSON_SET(COALESCE(cost_policy_json, JSON_OBJECT()),
       '$.default_model_slug', 'openai/gpt-4o-mini',
       '$.fallback_model_slug', 'openai/gpt-4o-mini',
       '$.model_selection_policy_key', 'openrouter_model_selection_policy_v1'),
       updated_at = CURRENT_TIMESTAMP
 WHERE provider_key = 'openrouter_openai_compatible';

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'openrouter_model_policy',
  'OpenRouter Model Policy Control',
  'Read or update the OpenRouter model selection policy. Controls default, fallback, writer, reviewer, and smoke model slugs such as openai/gpt-4o-mini. No secrets are returned.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','openrouter_model_policy'),
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string'),
        'maxItems',12,
        'description','Use --get or --default-model=openai/gpt-4o-mini --writer-model=... --reviewer-model=... --smoke-model=... --add-allowed=... --confirm=SET_OPENROUTER_MODEL_POLICY'
      )
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,ai_model_provider,openrouter,model_policy,no_secrets,allowlist,requires_confirmation,dynamic_model_selection',
  1,
  228
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
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;
