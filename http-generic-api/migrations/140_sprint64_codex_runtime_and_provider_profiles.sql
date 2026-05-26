-- Sprint 64: Codex CLI runtime and provider profiles.
-- Adds Codex as a first-class local coding-agent runtime alongside OpenClaude.
-- Stores no credentials and does not copy platform secrets to local devices.

INSERT INTO dev_agent_runtime_registry
  (runtime_key, display_name, runtime_type, provider_key, execution_surface,
   device_id, command_hint, supported_use_cases_json, capabilities_json,
   policy_json, status, notes)
VALUES
  ('codex_essam_chatgpt_v1', 'Codex CLI on Essam via ChatGPT OAuth', 'local_coding_agent', 'codex', 'local_device',
   'essam-pc', 'codex',
   '["repo_analysis","patch_planning","code_review","local_read_only_probe"]',
   '["chatgpt_oauth","api_key_optional","custom_model_providers","mcp","repo_analysis","patch_planning"]',
   '{"default_mode":"read_only_plan","auth_modes":["chatgpt_oauth","api_key","custom_provider"],"preferred_auth_mode":"chatgpt_oauth","can_execute_code":false,"can_mutate_repo":false,"requires_human_approval_for_write":true,"requires_branch_policy":true,"copy_platform_secret_to_device":false,"secrets_included":false,"repo_path":"D:\\\\mad4b-agent-workspaces\\\\growth-intelligence-os-readonly"}',
   'planned',
   'Codex CLI runtime planned for Essam. Preferred auth is ChatGPT OAuth/device login. Write and shell execution remain blocked until explicit approval gates are added.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  runtime_type = VALUES(runtime_type),
  provider_key = VALUES(provider_key),
  execution_surface = VALUES(execution_surface),
  device_id = VALUES(device_id),
  command_hint = VALUES(command_hint),
  supported_use_cases_json = VALUES(supported_use_cases_json),
  capabilities_json = VALUES(capabilities_json),
  policy_json = VALUES(policy_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO dev_agent_provider_registry
  (provider_key, display_name, provider_family, openclaude_provider_key, credential_mode,
   execution_surface, supported_runtime_types_json, required_env_names_json,
   capabilities_json, policy_json, status, notes)
VALUES
  ('codex_chatgpt_oauth', 'Codex ChatGPT OAuth Provider', 'codex_native', 'openai', 'local_service', 'local_device',
   '["local_coding_agent"]', '[]',
   '["chatgpt_oauth","codex_cli","repo_analysis","patch_planning"]',
   '{"copy_platform_secret_to_device":false,"requires_user_browser_login":true,"can_mutate_repo":false,"secrets_included":false}',
   'planned', 'Codex native ChatGPT OAuth login. User completes browser/device auth; no API key copied through the platform.'),
  ('codex_openai_api_env', 'Codex OpenAI API Provider', 'codex_native', 'openai', 'local_env', 'local_device',
   '["local_coding_agent"]', '["OPENAI_API_KEY"]',
   '["codex_cli","openai_api","repo_analysis","patch_planning"]',
   '{"copy_platform_secret_to_device":false,"requires_local_env":true,"can_mutate_repo":false,"secrets_included":false}',
   'planned', 'Codex OpenAI API key mode. Not preferred when ChatGPT OAuth is available.'),
  ('codex_openrouter_custom_provider', 'Codex OpenRouter Custom Provider', 'codex_custom_provider', 'openai', 'platform_managed', 'platform_control_plane',
   '["local_coding_agent"]', '[]',
   '["codex_cli","custom_model_provider","openrouter","openai_compatible","repo_analysis","patch_planning"]',
   '{"copy_platform_secret_to_device":false,"requires_provider_bridge":true,"can_mutate_repo":false,"secrets_included":false}',
   'planned', 'Codex custom provider profile for OpenRouter through a governed bridge or explicit local env configuration.'),
  ('codex_gemini_custom_provider', 'Codex Gemini Custom Provider', 'codex_custom_provider', 'gemini', 'platform_managed', 'platform_control_plane',
   '["local_coding_agent"]', '[]',
   '["codex_cli","custom_model_provider","gemini","repo_analysis","patch_planning"]',
   '{"copy_platform_secret_to_device":false,"requires_provider_bridge":true,"can_mutate_repo":false,"secrets_included":false}',
   'planned', 'Codex custom provider profile for Gemini through governed bridge or explicit local env configuration.'),
  ('codex_ollama_local', 'Codex Ollama Local Provider', 'codex_native', 'ollama', 'local_service', 'local_device',
   '["local_coding_agent"]', '[]',
   '["codex_cli","local_model","repo_analysis","patch_planning","offline_candidate"]',
   '{"copy_platform_secret_to_device":false,"requires_local_service":true,"can_mutate_repo":false,"secrets_included":false}',
   'planned', 'Codex local Ollama profile. Requires Ollama service and local model on Essam.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_family = VALUES(provider_family),
  openclaude_provider_key = VALUES(openclaude_provider_key),
  credential_mode = VALUES(credential_mode),
  execution_surface = VALUES(execution_surface),
  supported_runtime_types_json = VALUES(supported_runtime_types_json),
  required_env_names_json = VALUES(required_env_names_json),
  capabilities_json = VALUES(capabilities_json),
  policy_json = VALUES(policy_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO dev_agent_runtime_provider_profiles
  (profile_key, runtime_key, provider_key, profile_name, selection_mode,
   credential_mode, model_hint, endpoint_url, status, policy_json, metadata_json, notes)
VALUES
  ('codex_essam_chatgpt_oauth_v1', 'codex_essam_chatgpt_v1', 'codex_chatgpt_oauth', 'Codex ChatGPT OAuth on Essam', 'preferred', 'local_service', NULL, NULL, 'planned',
   '{"can_mutate_repo":false,"copy_platform_secret_to_device":false,"requires_user_login":true,"approval_required_for_write":true,"secrets_included":false}',
   '{"auth_mode":"chatgpt_oauth","login_command":"codex login --device-auth"}',
   'Preferred Codex profile. User authenticates locally with ChatGPT/Google; no API key is copied by the platform.'),
  ('codex_essam_openai_api_env_v1', 'codex_essam_chatgpt_v1', 'codex_openai_api_env', 'Codex OpenAI API local env', 'manual', 'local_env', NULL, NULL, 'planned',
   '{"can_mutate_repo":false,"copy_platform_secret_to_device":false,"requires_local_env":true,"secrets_included":false}',
   '{"env_key":"OPENAI_API_KEY"}',
   'Manual API-key profile. Not preferred over ChatGPT OAuth.'),
  ('codex_essam_openrouter_bridge_v1', 'codex_essam_chatgpt_v1', 'codex_openrouter_custom_provider', 'Codex OpenRouter custom provider bridge', 'fallback', 'platform_managed', NULL, NULL, 'planned',
   '{"can_mutate_repo":false,"copy_platform_secret_to_device":false,"requires_provider_bridge":true,"secrets_included":false}',
   '{"bridge_required":true,"codex_config_surface":"model_providers"}',
   'OpenRouter support for Codex through custom provider config and governed bridge.'),
  ('codex_essam_gemini_bridge_v1', 'codex_essam_chatgpt_v1', 'codex_gemini_custom_provider', 'Codex Gemini custom provider bridge', 'fallback', 'platform_managed', NULL, NULL, 'planned',
   '{"can_mutate_repo":false,"copy_platform_secret_to_device":false,"requires_provider_bridge":true,"secrets_included":false}',
   '{"bridge_required":true,"codex_config_surface":"model_providers"}',
   'Gemini support for Codex through custom provider config and governed bridge.'),
  ('codex_essam_ollama_local_v1', 'codex_essam_chatgpt_v1', 'codex_ollama_local', 'Codex Ollama local model on Essam', 'manual', 'local_service', NULL, 'http://127.0.0.1:11434', 'planned',
   '{"can_mutate_repo":false,"copy_platform_secret_to_device":false,"requires_local_service":true,"secrets_included":false}',
   '{"current_probe":"ollama_not_installed"}',
   'Optional local/offline Codex provider profile. Planned until Ollama is installed and model validated.')
ON DUPLICATE KEY UPDATE
  runtime_key = VALUES(runtime_key),
  provider_key = VALUES(provider_key),
  profile_name = VALUES(profile_name),
  selection_mode = VALUES(selection_mode),
  credential_mode = VALUES(credential_mode),
  model_hint = VALUES(model_hint),
  endpoint_url = VALUES(endpoint_url),
  status = VALUES(status),
  policy_json = VALUES(policy_json),
  metadata_json = VALUES(metadata_json),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
