-- Sprint 67: Refine capability simulation findings after first live run.
-- Scope: app registry metadata + policy update only.
-- No tools are executed, no secrets are stored, no workspace enum is expanded.

INSERT INTO app_integrations
  (app_key, display_name, description, auth_type, category, default_action_grants, status)
VALUES
  ('codex_chatgpt_oauth',
   'Codex ChatGPT OAuth',
   'User-owned local Codex CLI mode. Each user signs into Codex locally with their own ChatGPT account through Local Manager; platform stores capability status only.',
   'oauth2',
   'code',
   JSON_OBJECT(
     'credential_source','user_owned_personal',
     'runtime_surface','local_device_runtime',
     'requires_local_manager_device',true,
     'requires_user_login',true,
     'copy_user_oauth_token_to_platform',false,
     'secrets_included',false
   ),
   'active'),
  ('codex_openrouter_custom_provider',
   'Codex Platform-Managed Fallback',
   'Platform-managed Codex fallback backed by the governed OpenRouter/OpenClaude bridge for users without personal Codex access. Requires quota, audit, and disclosure.',
   'api_key',
   'code',
   JSON_OBJECT(
     'credential_source','platform_managed_fallback',
     'runtime_surface','openclaude_bridge',
     'provider_bridge','openrouter_openai_compatible',
     'model_policy_key','openrouter_model_selection_policy_v1',
     'requires_quota',true,
     'requires_audit_log',true,
     'requires_user_disclosure',true,
     'copy_platform_secret_to_device',false,
     'return_provider_api_key_to_agent',false,
     'secrets_included',false
   ),
   'active')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  auth_type = VALUES(auth_type),
  category = VALUES(category),
  default_action_grants = VALUES(default_action_grants),
  status = VALUES(status);

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.scenarios[2].expected.platform_fallback_secondary_only', true,
         '$.scenarios[2].expected.fallback_notes', 'User-owned Codex local OAuth is primary; platform-managed fallback is available only if local OAuth/device is unavailable, so quota/disclosure gates are enforced when fallback is selected rather than for the primary scenario.',
         '$.first_live_simulation_findings.codex_user_owned_local_review', 'Refined: secondary fallback should not force quota/disclosure gates on primary local OAuth path.',
         '$.first_live_simulation_findings.codex_openrouter_custom_provider', 'Refined: app_integrations rows added so Codex provider modes appear in v_app_integration_capability_map.'
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'dynamic_capability_use_case_simulation_suite_v1';
