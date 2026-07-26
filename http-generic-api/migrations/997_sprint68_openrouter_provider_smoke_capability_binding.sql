-- Sprint 68: OpenRouter provider smoke capability binding.
-- Scope: registry binding only. No secret values are stored here.
-- Enables capability-resolution evidence for the bounded OpenRouter live smoke
-- admin tool. The live smoke itself remains a separate operator-triggered
-- action that returns metadata only with secrets_included=false.

INSERT INTO `app_integration_action_bindings` (
  `binding_id`,
  `app_key`,
  `action_key`,
  `binding_role`,
  `credential_source`,
  `exposure_default`,
  `status`,
  `notes`
)
SELECT
  'openrouter_provider_smoke_capability_binding_v1',
  'openrouter_openai_compatible',
  'openrouter_provider_smoke',
  'transport',
  'platform_managed',
  'runtime_only',
  'active',
  'Bounded OpenRouter live provider smoke. Uses platform_secret:openrouter_api_key server-side; returns metadata only; no external write; no credential payload returned.'
WHERE NOT EXISTS (
  SELECT 1 FROM `app_integration_action_bindings`
   WHERE `binding_id` = 'openrouter_provider_smoke_capability_binding_v1'
);

INSERT INTO `credential_bindings` (
  `binding_id`,
  `tenant_id`,
  `owner_type`,
  `owner_id`,
  `action_key`,
  `target_key`,
  `credential_role`,
  `credential_ref`,
  `provider_family`,
  `connector_family`,
  `resolution_priority`,
  `status`,
  `created_by`
)
SELECT
  'openrouter-provider-smoke-platform-binding',
  '00000000-0000-0000-0000-000000000000',
  'platform',
  'growth_intelligence_platform',
  'openrouter_provider_smoke',
  'openrouter_docs_agent_provider',
  'api_key',
  'platform_secret:openrouter_api_key',
  'openrouter',
  'openai_compatible',
  10,
  'active',
  'migration_997_openrouter_provider_smoke_capability_binding'
WHERE NOT EXISTS (
  SELECT 1 FROM `credential_bindings`
   WHERE `binding_id` = 'openrouter-provider-smoke-platform-binding'
);

INSERT INTO `execution_policies` (
  `policy_group`,
  `policy_key`,
  `policy_value`,
  `active`,
  `execution_scope`,
  `affects_layer`,
  `blocking`,
  `notes`
)
SELECT
  'Agent Runtime Governance',
  'openrouter_provider_smoke_capability_binding_policy_v1',
  JSON_OBJECT(
    'rule', 'openrouter_provider_smoke_requires_capability_envelope',
    'tool_key', 'openrouter_provider_smoke',
    'app_key', 'openrouter_openai_compatible',
    'credential_source', 'platform_managed',
    'credential_ref_allowed', 'platform_secret:openrouter_api_key',
    'credential_payload_returned', false,
    'provider_call_allowed', true,
    'external_write_allowed', false,
    'external_send_allowed', false,
    'max_tokens_default', 8,
    'max_tokens_limit', 32,
    'secrets_included', false
  ),
  'TRUE',
  'agent_runtime|openrouter|provider_smoke|capability_envelope',
  'app_integration_action_bindings|credential_bindings|admin_platform_endpoint_tools|openrouter_provider_smoke',
  'TRUE',
  'OpenRouter live provider smoke may run only as bounded metadata-only smoke. It may read the platform secret server-side but must never return credential payloads or perform external writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'Agent Runtime Governance'
     AND `policy_key` = 'openrouter_provider_smoke_capability_binding_policy_v1'
);
