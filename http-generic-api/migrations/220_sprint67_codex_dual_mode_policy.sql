-- Sprint 67: Codex dual-mode tenant auth policy.
-- Supports two governed paths:
-- 1) user-owned local Codex CLI using each tenant user's ChatGPT OAuth on their device;
-- 2) platform-managed fallback through the platform provider bridge for users without personal Codex access.
-- No ChatGPT OAuth token, OpenAI API key, or OpenRouter key is stored in this migration.
-- Platform-managed fallback must not use an admin personal ChatGPT OAuth session as a shared secret.

UPDATE dev_agent_provider_registry
   SET status = 'active',
       policy_json = JSON_OBJECT(
         'mode', 'user_owned_local_oauth',
         'tenant_capable', true,
         'preferred', true,
         'requires_user_browser_login', true,
         'requires_local_manager_device', true,
         'requires_per_user_chatgpt_oauth', true,
         'uses_user_subscription', true,
         'copy_platform_secret_to_device', false,
         'return_user_oauth_token_to_platform', false,
         'server_side_shared_oauth_allowed', false,
         'can_mutate_repo', false,
         'default_repo_mode', 'read_only_plan',
         'approved_write_requires_human_approval', true,
         'requires_branch_policy', true,
         'secrets_included', false
       ),
       notes = 'Active tenant-capable Codex mode. Each user signs in locally with their own ChatGPT OAuth through Codex CLI/Local Manager. The platform stores capability metadata only and must not copy user OAuth tokens.',
       updated_at = CURRENT_TIMESTAMP
 WHERE provider_key = 'codex_chatgpt_oauth';

UPDATE dev_agent_provider_registry
   SET status = 'active',
       policy_json = JSON_OBJECT(
         'mode', 'platform_managed_fallback',
         'tenant_capable', true,
         'preferred', false,
         'fallback_only', true,
         'fallback_provider_key', 'openrouter_openai_compatible',
         'fallback_model_policy_key', 'openrouter_model_selection_policy_v1',
         'fallback_instruction_contract_key', 'docs_agent_openrouter_instruction_contract_v1',
         'requires_tenant_policy_allowance', true,
         'requires_quota_budget', true,
         'requires_audit_log', true,
         'requires_explicit_user_disclosure', true,
         'copy_platform_secret_to_device', false,
         'return_provider_api_key_to_agent', false,
         'server_side_shared_admin_oauth_allowed', false,
         'allowed_until_enterprise_account', true,
         'upgrade_target', 'enterprise_workspace_or_api_org',
         'can_mutate_repo', false,
         'default_repo_mode', 'read_only_plan',
         'approved_write_requires_human_approval', true,
         'requires_branch_policy', true,
         'secrets_included', false
       ),
       notes = 'Active platform-managed fallback for tenants without personal Codex access. Uses the platform provider bridge and quotas; must not share an admin personal ChatGPT OAuth token. Intended as temporary fallback until enterprise workspace/API org is available.',
       updated_at = CURRENT_TIMESTAMP
 WHERE provider_key = 'codex_openrouter_custom_provider'
   AND EXISTS (SELECT 1 FROM ai_model_providers WHERE provider_key='openrouter_openai_compatible' AND status='active' AND secrets_returned_to_agent=0)
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='openrouter_model_selection_policy_v1' AND status='active')
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='docs_agent_openrouter_instruction_contract_v1' AND status='active');

UPDATE dev_agent_runtime_provider_profiles
   SET status = 'available',
       credential_mode = 'local_service',
       policy_json = JSON_OBJECT(
         'mode', 'user_owned_local_oauth',
         'tenant_capable', true,
         'requires_user_login', true,
         'requires_local_manager_device', true,
         'copy_platform_secret_to_device', false,
         'return_user_oauth_token_to_platform', false,
         'can_mutate_repo', false,
         'default_repo_mode', 'read_only_plan',
         'approval_required_for_write', true,
         'secrets_included', false
       ),
       metadata_json = JSON_OBJECT(
         'auth_mode','chatgpt_oauth',
         'login_command','codex login --device-auth',
         'status_check_command','codex login status',
         'execution_surface','local_manager_device',
         'tenant_rollout','per_user_device_binding_required',
         'secrets_included',false
       ),
       notes = 'Tenant-capable personal Codex profile. Each tenant user must install Codex locally and authenticate with their own ChatGPT account; platform stores status metadata only.',
       updated_at = CURRENT_TIMESTAMP
 WHERE profile_key = 'codex_essam_chatgpt_oauth_v1'
   AND provider_key = 'codex_chatgpt_oauth';

UPDATE dev_agent_runtime_provider_profiles
   SET status = 'available',
       credential_mode = 'platform_managed',
       endpoint_url = '/dev-agent/openclaude/bridge/v1/chat/completions',
       model_hint = 'openai/gpt-4o-mini',
       policy_json = JSON_OBJECT(
         'mode', 'platform_managed_fallback',
         'tenant_capable', true,
         'fallback_only', true,
         'requires_provider_bridge', true,
         'provider_bridge_key', 'openrouter_openai_compatible',
         'model_policy_key', 'openrouter_model_selection_policy_v1',
         'requires_tenant_policy_allowance', true,
         'requires_quota_budget', true,
         'copy_platform_secret_to_device', false,
         'return_provider_api_key_to_agent', false,
         'server_side_shared_admin_oauth_allowed', false,
         'can_mutate_repo', false,
         'default_repo_mode', 'read_only_plan',
         'approval_required_for_write', true,
         'secrets_included', false
       ),
       metadata_json = JSON_OBJECT(
         'fallback_provider','openrouter_openai_compatible',
         'fallback_model_policy','openrouter_model_selection_policy_v1',
         'default_model_slug','openai/gpt-4o-mini',
         'temporary_until','enterprise_workspace_or_api_org',
         'billing_owner','platform',
         'tenant_usage_metering_required',true,
         'secrets_included',false
       ),
       notes = 'Platform-managed Codex fallback profile backed by the active OpenRouter bridge. Intended for tenants without personal Codex access; use quotas and audit. Does not share admin personal OAuth.',
       updated_at = CURRENT_TIMESTAMP
 WHERE profile_key = 'codex_essam_openrouter_bridge_v1'
   AND provider_key = 'codex_openrouter_custom_provider'
   AND EXISTS (SELECT 1 FROM dev_agent_provider_registry WHERE provider_key='codex_openrouter_custom_provider' AND status='active');

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('tenant_codex_dual_mode_policy_v1',
   JSON_OBJECT(
     'policy_key','tenant_codex_dual_mode_policy_v1',
     'status','active',
     'selection_order',JSON_ARRAY('user_owned_local_chatgpt_oauth','platform_managed_fallback'),
     'preferred_mode','user_owned_local_chatgpt_oauth',
     'fallback_mode','platform_managed_fallback',
     'user_owned_local_chatgpt_oauth',JSON_OBJECT(
       'provider_key','codex_chatgpt_oauth',
       'profile_key','codex_essam_chatgpt_oauth_v1',
       'runtime_key_template','codex_${device_id}_chatgpt_oauth_v1',
       'runs_on','user_local_device',
       'requires_local_manager_device',true,
       'requires_user_codex_login',true,
       'uses_user_chatgpt_plan',true,
       'server_receives_user_oauth_token',false,
       'copy_platform_secret_to_device',false,
       'secrets_included',false
     ),
     'platform_managed_fallback',JSON_OBJECT(
       'provider_key','codex_openrouter_custom_provider',
       'profile_key','codex_essam_openrouter_bridge_v1',
       'runs_on','platform_or_governed_bridge',
       'uses_platform_provider_bridge','openrouter_openai_compatible',
       'model_policy_key','openrouter_model_selection_policy_v1',
       'requires_tenant_policy_allowance',true,
       'requires_quota_budget',true,
       'requires_audit_log',true,
       'requires_user_disclosure','This run uses platform-managed provider capacity, not your personal ChatGPT plan.',
       'server_side_shared_admin_oauth_allowed',false,
       'copy_platform_secret_to_device',false,
       'return_provider_api_key_to_agent',false,
       'temporary_until','enterprise_workspace_or_api_org',
       'secrets_included',false
     ),
     'repo_policy',JSON_OBJECT(
       'default_mode','read_only_plan',
       'write_requires_human_approval',true,
       'write_requires_branch_policy',true,
       'local_shell_requires_allowlist',true,
       'repo_mutation_default_allowed',false
     ),
     'upgrade_path',JSON_OBJECT(
       'target','enterprise_workspace_or_api_org',
       'preferred_future_modes',JSON_ARRAY('workspace_managed_codex','api_org_codex_automation'),
       'notes','Replace temporary platform-managed fallback with enterprise workspace/API-org governance when available.'
     ),
     'secrets_included',false
   ),
   'active',
   'Tenant Codex dual-mode policy: user-owned local ChatGPT OAuth first, platform-managed fallback second. No user/admin OAuth token sharing.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
