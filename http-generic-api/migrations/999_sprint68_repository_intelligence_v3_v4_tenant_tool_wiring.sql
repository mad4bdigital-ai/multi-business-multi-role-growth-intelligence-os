-- Sprint 68: Repository Intelligence V3/V4 tenant tool wiring.
-- Scope: registry rows only. No provider calls, no repository mutations, no secrets.

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_repository_intelligence_report',
  'Tenant Repository Intelligence Report',
  'Read-only Repository Intelligence V3 report. Returns classification summaries, top risks, manual recommendations, PR evidence, and optional Markdown/JSON output. No comments, labels, merges, patches, force pushes, migrations, provider calls, credential payloads, or external writes.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_intelligence_report'),
  'tenant,repository_intelligence,v3,read_only,no_secrets,no_provider_call,no_external_write,no_mutation,system_layer_tool',
  1,
  365
),
(
  'tenant_repository_action_planner_dry_run',
  'Tenant Repository Action Planner Dry Run',
  'Repository Intelligence V4 dry-run action planner. Produces non-executed action plans only. No comments, labels, merges, patches, force pushes, migrations, provider calls, credential payloads, or external writes.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_action_planner_dry_run'),
  'tenant,repository_intelligence,v4,dry_run,no_secrets,no_provider_call,no_external_write,no_mutation,system_layer_tool',
  1,
  366
),
(
  'tenant_repository_intelligence_v3_v4_readiness_smoke',
  'Tenant Repository Intelligence V3/V4 Readiness Smoke',
  'No-secret Repository Intelligence V3/V4 readiness smoke. Validates report and action-planner wiring without repository mutations or external writes.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_intelligence_v3_v4_readiness_smoke'),
  'tenant,repository_intelligence,v3,v4,readiness_smoke,no_secrets,no_provider_call,no_external_write,no_mutation,system_layer_tool',
  1,
  367
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
  'tenant_repository_intelligence_v3_v4_tool_wiring_policy_v1',
  JSON_OBJECT(
    'tools', JSON_ARRAY('tenant_repository_intelligence_report','tenant_repository_action_planner_dry_run','tenant_repository_intelligence_v3_v4_readiness_smoke'),
    'repository_mutations_allowed', false,
    'provider_calls_allowed', false,
    'credential_payload_returned', false,
    'external_writes_allowed', false,
    'secrets_included', false
  ),
  'TRUE',
  'tenant_repository_intelligence|v3|v4|tool_wiring|read_only|dry_run',
  'tenant_platform_endpoint_tools|systemLayerRoutes|repositoryTenantIntelligenceV2|releaseReadiness',
  'TRUE',
  'Repository Intelligence V3/V4 tenant tools are read-only/dry-run system-layer surfaces and must never mutate repositories from these tool entries.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
