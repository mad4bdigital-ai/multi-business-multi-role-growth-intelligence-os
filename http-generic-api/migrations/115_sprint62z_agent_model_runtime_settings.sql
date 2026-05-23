-- Sprint 62z: governed agent model runtime settings
--
-- Secrets stay in environment/vault. This row stores only provider order,
-- env-var references, and model IDs per execution class.

INSERT INTO `platform_runtime_config` (`config_key`, `config_json`, `status`, `note`)
VALUES (
  'agent_model_runtime',
  '{"version":1,"free_first":true,"provider_order":["gemini","openrouter","openai","anthropic"],"providers":{"gemini":{"enabled":true,"credential_env_var":"GEMINI_API_KEY","fallback_credential_env_vars":["GOOGLE_AI_API_KEY"],"default_model":"gemini-3.5-flash","models":{"standard":"gemini-3.5-flash","complex":"gemini-3.5-flash","authority":"gemini-3.5-flash"}},"openrouter":{"enabled":true,"credential_env_var":"OPENROUTER_API_KEY","default_model":"openrouter/free","models":{"standard":"openrouter/free","complex":"openrouter/free","authority":"openrouter/free"},"optional_headers":{"site_url_env_var":"OPENROUTER_SITE_URL","app_name_env_var":"OPENROUTER_APP_NAME"}},"openai":{"enabled":true,"credential_env_var":"OPENAI_API_KEY","default_model":"gpt-4o-mini","models":{"standard":"gpt-4o-mini","complex":"gpt-4o","authority":"gpt-4o"}},"anthropic":{"enabled":true,"credential_env_var":"ANTHROPIC_API_KEY","default_model":"claude-haiku-4-5-20251001","models":{"standard":"claude-haiku-4-5-20251001","complex":"claude-sonnet-4-6","authority":"claude-opus-4-7"}}}}',
  'active',
  'Governed agent model routing settings; no secrets stored here.'
)
ON DUPLICATE KEY UPDATE
  `config_json` = VALUES(`config_json`),
  `status` = VALUES(`status`),
  `note` = VALUES(`note`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'dev_agent_model_settings_get',
  'Dev Agent Model Settings Get',
  'Read sanitized governed model runtime settings, provider order, configured env-var names, selected models, and credential presence flags. Never returns secret values.',
  'GET',
  '/dev-agent/model-settings',
  NULL,
  '{"type":"object","properties":{"force":{"type":"boolean","default":false}}}',
  NULL,
  'dev_agent,model,settings,read_only',
  1,
  122
),
(
  'dev_agent_model_settings_update',
  'Dev Agent Model Settings Update',
  'Update governed model runtime settings. Accepts provider order and model IDs only; secret-like fields are rejected by the route.',
  'PATCH',
  '/dev-agent/model-settings',
  NULL,
  '{"type":"object","properties":{"settings":{"type":"object","additionalProperties":true}},"additionalProperties":true}',
  NULL,
  'dev_agent,model,settings,state_changing,audited',
  1,
  123
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
