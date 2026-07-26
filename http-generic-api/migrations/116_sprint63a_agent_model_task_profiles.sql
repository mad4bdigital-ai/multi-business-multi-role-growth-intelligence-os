-- Sprint 63a: task-specific model runtime profiles
--
-- Adds model routing by task_class so the platform can pin specific models for
-- summaries, classifiers, and future image editing without hardcoding route code.
-- Secrets remain in environment/vault only.

INSERT INTO `platform_runtime_config` (`config_key`, `config_json`, `status`, `note`)
VALUES (
  'agent_model_runtime',
  '{"version":2,"free_first":true,"provider_order":["gemini","openrouter","openai","anthropic"],"providers":{"gemini":{"enabled":true,"credential_env_var":"GEMINI_API_KEY","fallback_credential_env_vars":["GOOGLE_AI_API_KEY"],"default_model":"gemini-3.5-flash","models":{"standard":"gemini-3.5-flash","complex":"gemini-3.5-flash","authority":"gemini-3.5-flash"}},"openrouter":{"enabled":true,"credential_env_var":"OPENROUTER_API_KEY","default_model":"openrouter/free","models":{"standard":"openrouter/free","complex":"openrouter/free","authority":"openrouter/free"},"optional_headers":{"site_url_env_var":"OPENROUTER_SITE_URL","app_name_env_var":"OPENROUTER_APP_NAME"}},"openai":{"enabled":true,"credential_env_var":"OPENAI_API_KEY","default_model":"gpt-4o-mini","models":{"standard":"gpt-4o-mini","complex":"gpt-4o","authority":"gpt-4o"}},"anthropic":{"enabled":true,"credential_env_var":"ANTHROPIC_API_KEY","default_model":"claude-haiku-4-5-20251001","models":{"standard":"claude-haiku-4-5-20251001","complex":"claude-sonnet-4-6","authority":"claude-opus-4-7"}}},"task_profiles":{"summary":{"execution_class":"standard","provider_order":["gemini","openrouter","openai","anthropic"],"models":{"gemini":"gemini-3.5-flash","openrouter":"openrouter/free","openai":"gpt-4o-mini","anthropic":"claude-haiku-4-5-20251001"}},"classification":{"execution_class":"standard","provider_order":["gemini","openrouter","openai"],"models":{"gemini":"gemini-2.5-flash-lite","openrouter":"openrouter/free","openai":"gpt-4o-mini"}},"image_edit":{"execution_class":"image_edit","provider_order":["gemini"],"models":{"gemini":"gemini-3.1-flash-image-preview"}}}}',
  'active',
  'Governed model routing with task-specific profiles: summaries, classification, and image edit/Nano Banana.'
)
ON DUPLICATE KEY UPDATE
  `config_json` = VALUES(`config_json`),
  `status` = VALUES(`status`),
  `note` = VALUES(`note`),
  `updated_at` = CURRENT_TIMESTAMP;
