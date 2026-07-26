-- Sprint 68: OpenRouter provider smoke app/capability map binding.
-- Scope: registry binding only. No secret values are stored here.
-- Completes app_integrations/actions/tool binding rows required by
-- v_app_integration_capability_map so the bounded OpenRouter live smoke can
-- resolve through the capability envelope gates.

INSERT INTO `app_integrations` (
  `app_key`,
  `display_name`,
  `description`,
  `auth_type`,
  `category`,
  `status`
) VALUES (
  'openrouter_openai_compatible',
  'OpenRouter OpenAI-Compatible Provider',
  'Platform-managed OpenRouter OpenAI-compatible model provider bridge used for bounded no-secret provider dispatch smoke and Docs Agent model profiles.',
  'api_key',
  'ai_model_provider',
  'active'
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `auth_type` = VALUES(`auth_type`),
  `category` = VALUES(`category`),
  `status` = 'active';

INSERT INTO `actions` (
  `action_key`,
  `status`,
  `connector_family`,
  `api_key_mode`,
  `runtime_capability_class`,
  `runtime_callable`,
  `primary_executor`,
  `notes`
) VALUES (
  'openrouter_provider_smoke',
  'active',
  'openai_compatible',
  'platform_managed',
  'ai_model_provider_live_smoke',
  'TRUE',
  'openrouter_provider_smoke',
  'Bounded OpenRouter provider live smoke. Uses platform-managed credential server-side, returns metadata only, performs no external writes, and does not expose credential payloads.'
)
ON DUPLICATE KEY UPDATE
  `status` = 'active',
  `connector_family` = VALUES(`connector_family`),
  `api_key_mode` = VALUES(`api_key_mode`),
  `runtime_capability_class` = VALUES(`runtime_capability_class`),
  `runtime_callable` = VALUES(`runtime_callable`),
  `primary_executor` = VALUES(`primary_executor`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings` (
  `binding_id`,
  `app_key`,
  `tool_key`,
  `tool_surface`,
  `binding_role`,
  `credential_source`,
  `exposure_scope`,
  `status`,
  `notes`
) VALUES (
  'openrouter_provider_smoke_admin_tool_binding_v1',
  'openrouter_openai_compatible',
  'openrouter_provider_smoke',
  'admin_platform_tool',
  'diagnostic',
  'platform_managed',
  'admin',
  'active',
  'Admin-only bounded provider live smoke. No secret output, no external write, no promotion without explicit confirmation.'
)
ON DUPLICATE KEY UPDATE
  `tool_surface` = VALUES(`tool_surface`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_scope` = VALUES(`exposure_scope`),
  `status` = 'active',
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`,
  `policy_key`,
  `policy_value`,
  `active`,
  `execution_scope`,
  `affects_layer`,
  `blocking`,
  `notes`
) VALUES (
  'Agent Runtime Governance',
  'openrouter_provider_smoke_app_map_binding_policy_v1',
  JSON_OBJECT(
    'rule', 'openrouter_provider_smoke_requires_app_capability_map',
    'app_key', 'openrouter_openai_compatible',
    'action_key', 'openrouter_provider_smoke',
    'tool_key', 'openrouter_provider_smoke',
    'runtime_callable', true,
    'tool_surface', 'admin_platform_tool',
    'provider_call_allowed', true,
    'credential_payload_returned', false,
    'external_write_allowed', false,
    'external_send_allowed', false,
    'secrets_included', false
  ),
  'TRUE',
  'agent_runtime|openrouter|provider_smoke|app_capability_map',
  'app_integrations|actions|app_integration_action_bindings|app_integration_tool_bindings|admin_platform_endpoint_tools|openrouter_provider_smoke',
  'TRUE',
  'OpenRouter live provider smoke must resolve through app integration, action, tool binding, credential binding, and capability envelope gates before dispatch.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
