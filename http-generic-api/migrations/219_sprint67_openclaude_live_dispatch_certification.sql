-- Sprint 67: Certify scoped OpenClaude live provider dispatch through OpenRouter.
-- Scope: route/tool registry + runtime dispatch certification only.
-- Preconditions: OpenRouter provider active, model policy active, OpenClaude OpenRouter profile active,
-- and OpenRouter instruction contract has active live-smoke evidence. No secrets are stored here.

UPDATE admin_platform_endpoint_tools
   SET display_name = 'OpenClaude Bridge Chat Completions',
       description = 'OpenAI-compatible chat-completions endpoint for OpenClaude. Supports dry_run=true with no provider call and live_dispatch=true only after dispatch certification. Live dispatch uses the platform-managed OpenRouter secret server-side and never returns provider credentials.',
       input_schema = '{"type":"object","properties":{"dry_run":{"type":"boolean"},"live_dispatch":{"type":"boolean"},"profile_key":{"type":"string","default":"openclaude_essam_openrouter_bridge_v1"},"provider_key":{"type":"string","default":"openclaude_openrouter_openai_compatible"},"model":{"type":"string","description":"Optional allowlisted OpenRouter model slug. Defaults from openrouter_model_selection_policy_v1."},"max_tokens":{"type":"integer","minimum":1,"maximum":2048,"default":256},"timeout_ms":{"type":"integer","minimum":1000,"maximum":30000,"default":15000},"messages":{"type":"array","items":{"type":"object","properties":{"role":{"type":"string","enum":["system","user","assistant"]},"content":{"type":"string","maxLength":8000}},"required":["role","content"],"additionalProperties":false},"maxItems":20},"prompt":{"type":"string","maxLength":4000}},"oneOf":[{"required":["dry_run"]},{"required":["live_dispatch"]}],"additionalProperties":false}',
       tags = 'dev_agent,openclaude,provider_bridge,chat_completions,openai_compatible,no_secrets,no_local_execution,no_repo_mutation,live_dispatch,scoped_dispatch,openrouter',
       is_enabled = 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'dev_agent_openclaude_bridge_chat_dry_run';

UPDATE admin_platform_endpoint_tools
   SET display_name = 'OpenClaude Bridge Health',
       description = 'Read the OpenClaude provider bridge readiness. Reports active OpenClaude OpenRouter profile, dispatch certification, no-secret/no-repo-mutation policy, and health metadata.',
       tags = 'dev_agent,openclaude,provider_bridge,health,read_only,no_secrets,no_provider_key_returned,no_local_execution,no_repo_mutation,live_dispatch_readiness',
       is_enabled = 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'dev_agent_openclaude_bridge_health';

UPDATE runtime_dispatch_certification_registry
   SET certification_status = 'openrouter_live_smoke_passed_scoped_openclaude_dispatch_enabled',
       smoke_strategy = 'Dry-run must prove no provider call; live smoke must use active OpenRouter provider through server-side platform secret with no local execution, no repo mutation, no provider secret return, allowlisted model policy, and audit/readback evidence.',
       dispatch_allowed = 1,
       apply_allowed = 0,
       requires_resource_authority = 1,
       requires_dry_run = 1,
       requires_audit_evidence = 1,
       requires_readback = 1,
       last_evidence_ref = 'platform_runtime_config:docs_agent_openrouter_instruction_contract_v1:active_live_provider_dispatch_smoke_passed',
       last_certified_at = CURRENT_TIMESTAMP,
       notes = 'Scoped OpenClaude bridge live dispatch is enabled for read-only provider calls through active OpenRouter platform bridge. No provider secret is copied to device or returned to agent. Repo mutation and local shell execution remain blocked.',
       updated_at = CURRENT_TIMESTAMP
 WHERE certification_key = 'openclaude_platform_provider_bridge_v1'
   AND EXISTS (SELECT 1 FROM dev_agent_provider_registry WHERE provider_key='openclaude_openrouter_openai_compatible' AND status='active')
   AND EXISTS (SELECT 1 FROM dev_agent_runtime_provider_profiles WHERE profile_key='openclaude_essam_openrouter_bridge_v1' AND status='active')
   AND EXISTS (SELECT 1 FROM ai_model_providers WHERE provider_key='openrouter_openai_compatible' AND status='active' AND secrets_returned_to_agent=0)
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='openrouter_model_selection_policy_v1' AND status='active')
   AND EXISTS (SELECT 1 FROM platform_runtime_config WHERE config_key='docs_agent_openrouter_instruction_contract_v1' AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.activation_status'))='active_live_provider_dispatch_smoke_passed');

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.status', 'active_scoped_live_dispatch_enabled',
         '$.provider_dispatch_enabled', true,
         '$.preferred_profile_key', 'openclaude_essam_openrouter_bridge_v1',
         '$.active_provider_key', 'openclaude_openrouter_openai_compatible',
         '$.model_policy_key', 'openrouter_model_selection_policy_v1',
         '$.hard_limits.copy_platform_secret_to_device', false,
         '$.hard_limits.return_provider_api_key_to_agent', false,
         '$.hard_limits.repo_mutation', false,
         '$.hard_limits.local_shell_execution', false,
         '$.hard_limits.secrets_included', false
       ),
       note = 'OpenClaude bridge contract active for scoped live provider dispatch via OpenRouter. Provider secrets remain server-side; repo mutation and local shell remain blocked.',
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'openclaude_provider_bridge_contract_v1';
