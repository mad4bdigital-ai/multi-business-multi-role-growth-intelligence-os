-- Sprint 68: Repository Advisory Comment V5 tenant tool wiring.
-- Scope: registry/policy rows only. No provider calls, no repository mutations, no secrets.
-- Safety: No credential payload reads. No raw secrets. No external send. No external writes. secrets_included=false

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_repository_advisory_comment_preview',
  'Tenant Repository Advisory Comment Preview',
  'Repository Advisory Comment V5 preview. Produces a no-mutation advisory comment preview only. No provider calls, no repository writes, no comments posted, no labels, no merges, no patches, no force pushes, no credential payloads, and no secrets.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_preview'),
  'tenant,repository_intelligence,v5,advisory_comment,preview,no_secrets,no_provider_call,no_external_write,no_repository_mutation,no_mutation,system_layer_tool',
  1,
  368
),
(
  'tenant_repository_advisory_comment_apply',
  'Tenant Repository Advisory Comment Apply',
  'Repository Advisory Comment V5 apply surface. Registered as policy-gated and disabled for mutation by default; requires explicit future apply authorization before any repository comment write. This registry wiring performs no write.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_apply'),
  'tenant,repository_intelligence,v5,advisory_comment,apply,gated,no_secrets,no_provider_call,no_external_write,no_repository_mutation,no_mutation,system_layer_tool',
  1,
  369
),
(
  'tenant_repository_advisory_comment_readback',
  'Tenant Repository Advisory Comment Readback',
  'Repository Advisory Comment V5 readback. Reads metadata-only advisory comment evidence. No provider calls, no repository writes, no credential payloads, and no secrets.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_readback'),
  'tenant,repository_intelligence,v5,advisory_comment,readback,no_secrets,no_provider_call,no_external_write,no_repository_mutation,no_mutation,system_layer_tool',
  1,
  370
),
(
  'tenant_repository_advisory_comment_v5_readiness_smoke',
  'Tenant Repository Advisory Comment V5 Readiness Smoke',
  'Repository Advisory Comment V5 readiness smoke. Validates preview/apply/readback wiring without provider calls, repository mutations, credential payloads, or secrets.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_v5_readiness_smoke'),
  'tenant,repository_intelligence,v5,advisory_comment,readiness_smoke,no_secrets,no_provider_call,no_external_write,no_repository_mutation,no_mutation,system_layer_tool',
  1,
  371
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`
) VALUES (
  'Repository Intelligence Governance',
  'tenant_repository_advisory_comment_v5_tool_wiring_policy_v1',
  JSON_OBJECT(
    'tools', JSON_ARRAY('tenant_repository_advisory_comment_preview','tenant_repository_advisory_comment_apply','tenant_repository_advisory_comment_readback','tenant_repository_advisory_comment_v5_readiness_smoke'),
    'repository_mutations_allowed_by_default', false,
    'provider_calls_allowed', false,
    'credential_payload_returned', false,
    'external_writes_allowed', false,
    'secrets_included', false,
    'apply_requires_future_explicit_authorization', true
  ),
  'TRUE',
  'tenant_repository_intelligence|v5|advisory_comment|tool_wiring|preview|readback|gated_apply',
  'tenant_platform_endpoint_tools|systemLayerRoutes|repositoryTenantAdvisoryCommentsV5|releaseReadiness',
  'TRUE',
  'Repository Advisory Comment V5 tenant tools are registered as preview/readback/readiness safe; apply is gated and must not mutate repositories without future explicit authorization.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
