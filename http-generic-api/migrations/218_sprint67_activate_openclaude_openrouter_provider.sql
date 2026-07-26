-- Sprint 67: Activate OpenClaude OpenRouter via OpenAI-compatible provider.
-- Scope: dev-agent provider/profile registry + runtime config only.
-- Preconditions already satisfied by OpenRouter activation:
-- - openrouter_openai_compatible provider is active
-- - openrouter_docs_agent_writer_v1/reviewer_v1 are active
-- - openrouter_model_selection_policy_v1 is active
-- - platform_secret:openrouter_api_key is bound and live smoke passed
-- No provider secret is copied to devices or returned to agents.

UPDATE dev_agent_provider_registry
   SET status = 'active',
       policy_json = JSON_OBJECT(
         'copy_platform_secret_to_device', false,
         'requires_provider_bridge', true,
         'preferred_for_docs_agent', false,
         'platform_api_only', true,
         'uses_active_platform_provider_key', 'openrouter_openai_compatible',
         'uses_model_policy_key', 'openrouter_model_selection_policy_v1',
         'uses_instruction_contract_key', 'docs_agent_openrouter_instruction_contract_v1',
         'openclaude_provider_key', 'openai',
         'openai_compatible_endpoint_shape', '/dev-agent/openclaude/bridge/v1/chat/completions',
         'can_mutate_repo', false,
         'repo_mutation_allowed', false,
         'copy_platform_secret_to_device_allowed', false,
         'return_provider_api_key_to_agent', false,
         'requires_read_only_tools', true,
         'allowed_openclaude_tools', JSON_ARRAY('Read','Grep','Glob','LS'),
         'denied_openclaude_tools', JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),
         'secrets_included', false
       ),
       notes = 'Activated after OpenRouter provider live smoke passed. OpenClaude may use OpenRouter only through the governed OpenAI-compatible platform bridge; no OpenRouter API key is copied to device or returned to agent.',
       updated_at = CURRENT_TIMESTAMP
 WHERE provider_key = 'openclaude_openrouter_openai_compatible'
   AND EXISTS (SELECT 1 FROM ai_model_providers WHERE provider_key='openrouter_openai_compatible' AND status='active' AND secrets_returned_to_agent=0)
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='openrouter_model_selection_policy_v1' AND status='active')
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='docs_agent_openrouter_instruction_contract_v1' AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.activation_status'))='active_live_provider_dispatch_smoke_passed');

UPDATE dev_agent_runtime_provider_profiles
   SET status = 'active',
       selection_mode = 'fallback',
       credential_mode = 'platform_managed',
       model_hint = 'openai/gpt-4o-mini',
       endpoint_url = '/dev-agent/openclaude/bridge/v1/chat/completions',
       policy_json = JSON_OBJECT(
         'can_mutate_repo', false,
         'copy_platform_secret_to_device', false,
         'requires_provider_bridge', true,
         'platform_api_only', true,
         'uses_active_platform_provider_key', 'openrouter_openai_compatible',
         'uses_model_policy_key', 'openrouter_model_selection_policy_v1',
         'allowed_tools', JSON_ARRAY('Read','Grep','Glob','LS'),
         'denied_tools', JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),
         'repo_mutation_allowed', false,
         'local_shell_execution_allowed', false,
         'provider_dispatch_requires_platform_bridge', true,
         'secrets_included', false
       ),
       metadata_json = JSON_OBJECT(
         'bridge_required', true,
         'endpoint_live', true,
         'openrouter_provider_status', 'active',
         'model_policy_key', 'openrouter_model_selection_policy_v1',
         'default_model_slug', 'openai/gpt-4o-mini',
         'activation_evidence', 'openrouter live provider smoke passed and provider promoted active',
         'secrets_included', false
       ),
       notes = 'Active OpenClaude fallback profile backed by OpenRouter through the governed OpenAI-compatible platform bridge. Read-only repo-analysis only; no local provider secret.',
       updated_at = CURRENT_TIMESTAMP
 WHERE profile_key = 'openclaude_essam_openrouter_bridge_v1'
   AND provider_key = 'openclaude_openrouter_openai_compatible';

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.openclaude_openrouter_provider_status', 'active',
         '$.openclaude_openrouter_profile_key', 'openclaude_essam_openrouter_bridge_v1',
         '$.openclaude_openrouter_provider_key', 'openclaude_openrouter_openai_compatible',
         '$.openclaude_openrouter_model_policy_key', 'openrouter_model_selection_policy_v1',
         '$.openclaude_openrouter_default_model_slug', 'openai/gpt-4o-mini',
         '$.openclaude_openrouter_secrets_included', false
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'openclaude_provider_bridge_contract_v1';

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('openclaude_openrouter_openai_compatible_activation_v1',
   JSON_OBJECT(
     'provider_key','openclaude_openrouter_openai_compatible',
     'profile_key','openclaude_essam_openrouter_bridge_v1',
     'status','active',
     'depends_on_provider_key','openrouter_openai_compatible',
     'depends_on_model_policy_key','openrouter_model_selection_policy_v1',
     'instruction_contract_key','docs_agent_openrouter_instruction_contract_v1',
     'endpoint_shape','openai_compatible_chat_completions',
     'endpoint_path','/dev-agent/openclaude/bridge/v1/chat/completions',
     'default_model_slug','openai/gpt-4o-mini',
     'credential_boundary','platform_managed_secret_reference_only',
     'copy_platform_secret_to_device',false,
     'return_provider_api_key_to_agent',false,
     'repo_mutation_allowed',false,
     'allowed_tools',JSON_ARRAY('Read','Grep','Glob','LS'),
     'denied_tools',JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),
     'activation_evidence',JSON_OBJECT(
       'openrouter_provider_active',true,
       'openrouter_live_smoke_passed',true,
       'model_policy_active',true
     ),
     'secrets_included',false
   ),
   'active',
   'OpenClaude OpenRouter via OpenAI-compatible provider activation evidence. No secrets are stored here.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
