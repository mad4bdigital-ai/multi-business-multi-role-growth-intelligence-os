-- Sprint 68: System-layer descriptor auto-wiring
-- Purpose:
--   Makes descriptor-backed system-layer tools visible in the tenant tool registry and records
--   descriptor source metadata so future descriptor sources can be added without repeating
--   manual dispatch switch wiring.
-- Safety:
--   Metadata/registry migration only. No provider calls. No repository writes. No secrets.

CREATE TABLE IF NOT EXISTS `system_layer_tool_descriptor_source_registry` (
  `source_key` VARCHAR(128) NOT NULL PRIMARY KEY,
  `module_path` VARCHAR(255) NOT NULL,
  `descriptor_export` VARCHAR(128) NOT NULL,
  `handler_resolution_mode` ENUM('handler_name_or_snake_to_camel','explicit_only') NOT NULL DEFAULT 'handler_name_or_snake_to_camel',
  `tool_count_expected` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO `system_layer_tool_descriptor_source_registry`
  (`source_key`, `module_path`, `descriptor_export`, `handler_resolution_mode`, `tool_count_expected`, `status`, `metadata_json`, `secrets_included`)
VALUES
  ('repository_tenant_intelligence_v2','repositoryTenantIntelligenceV2.js','TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS','handler_name_or_snake_to_camel',8,'active',JSON_OBJECT('no_provider_write',true,'no_external_write',true,'secrets_included',false),0),
  ('repository_tenant_advisory_comment_v5','repositoryTenantAdvisoryCommentsV5.js','TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS','handler_name_or_snake_to_camel',4,'active',JSON_OBJECT('approval_gated_comment_only',true,'forbidden_mutations',JSON_ARRAY('close','label','merge','patch','force_push','migration_apply'),'secrets_included',false),0)
ON DUPLICATE KEY UPDATE
  `module_path`=VALUES(`module_path`),
  `descriptor_export`=VALUES(`descriptor_export`),
  `handler_resolution_mode`=VALUES(`handler_resolution_mode`),
  `tool_count_expected`=VALUES(`tool_count_expected`),
  `status`=VALUES(`status`),
  `metadata_json`=VALUES(`metadata_json`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_repository_advisory_comment_preview',
  'Tenant Repository Advisory Comment Preview',
  'Repository Intelligence V5 preview for approval-gated advisory GitHub PR comments. Creates bounded comment preview and internal evidence only; no GitHub write.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_preview'),
  'tenant,repository_intelligence,v5,advisory_comment,preview,approval_required,no_secrets,no_provider_write,no_external_write,system_layer_tool,descriptor_backed',
  1,
  368
),
(
  'tenant_repository_advisory_comment_apply',
  'Tenant Repository Advisory Comment Apply',
  'Repository Intelligence V5 approval-gated comment-only apply. Posts exactly one advisory PR comment after approved approval_hold_id; never labels, closes, merges, patches, force-pushes, or applies migrations.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_apply'),
  'tenant,repository_intelligence,v5,advisory_comment,apply,approval_required,comment_only,no_secrets,no_repository_mutation_except_comment,no_external_write,system_layer_tool,descriptor_backed',
  1,
  369
),
(
  'tenant_repository_advisory_comment_readback',
  'Tenant Repository Advisory Comment Readback',
  'Repository Intelligence V5 readback for posted advisory PR comments. Verifies comment id, marker, body hash, and no-secret bounded metadata.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_readback'),
  'tenant,repository_intelligence,v5,advisory_comment,readback,no_secrets,no_provider_write,no_external_write,system_layer_tool,descriptor_backed',
  1,
  370
),
(
  'tenant_repository_advisory_comment_v5_readiness_smoke',
  'Tenant Repository Advisory Comment V5 Readiness Smoke',
  'Repository Intelligence V5 smoke. Creates preview and proves apply is blocked without approval; no GitHub comment is posted by default.',
  'POST',
  '/system/tools/call',
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tool_args',JSON_OBJECT('type','object','additionalProperties',true)),'required',JSON_ARRAY('tool_args')),
  JSON_OBJECT('name','tenant_repository_advisory_comment_v5_readiness_smoke'),
  'tenant,repository_intelligence,v5,advisory_comment,readiness_smoke,no_secrets,no_provider_write,no_external_write,system_layer_tool,descriptor_backed',
  1,
  371
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`),
  `http_path`=VALUES(`http_path`),
  `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`),
  `tags`=VALUES(`tags`),
  `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`);

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`
) VALUES (
  'System Layer Tool Governance',
  'system_layer_descriptor_auto_wiring_policy_v1',
  JSON_OBJECT(
    'rule','system_layer_descriptor_auto_wiring',
    'descriptor_sources',JSON_ARRAY('repository_tenant_intelligence_v2','repository_tenant_advisory_comment_v5'),
    'handler_resolution_mode','handler_name_or_snake_to_camel',
    'fail_closed_on_missing_handler',true,
    'future_source_contract',JSON_OBJECT('requires_descriptor_export',true,'requires_handler_exports',true,'requires_registry_migration_for_tenant_tool_rows',true),
    'provider_calls_allowed_from_wiring',false,
    'external_writes_allowed_from_wiring',false,
    'secrets_included',false
  ),
  'TRUE',
  'system_layer_tools|descriptor_sources|auto_wiring|future_sources|fail_closed',
  'systemLayerRoutes|system_layer_tool_descriptor_source_registry|tenant_platform_endpoint_tools|releaseReadiness',
  'TRUE',
  'Descriptor-backed system-layer tools are listed and dispatched from descriptor sources. New sources are registered as descriptor sources with handler exports and no manual switch-case wiring.'
)
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),
  `active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`
) VALUES (
  'Repository Intelligence Governance',
  'tenant_repository_advisory_comment_v5_tool_wiring_policy_v1',
  JSON_OBJECT(
    'tools',JSON_ARRAY('tenant_repository_advisory_comment_preview','tenant_repository_advisory_comment_apply','tenant_repository_advisory_comment_readback','tenant_repository_advisory_comment_v5_readiness_smoke'),
    'approval_required_for_apply',true,
    'comment_only_exception',true,
    'forbidden_mutations',JSON_ARRAY('close','label','merge','patch','force_push','migration_apply'),
    'provider_writes_allowed_without_approval',false,
    'credential_payload_returned',false,
    'external_writes_allowed',false,
    'secrets_included',false
  ),
  'TRUE',
  'tenant_repository_intelligence|v5|advisory_comment|approval_gated|comment_only',
  'tenant_platform_endpoint_tools|systemLayerRoutes|repositoryTenantAdvisoryCommentsV5|releaseReadiness',
  'TRUE',
  'Repository Intelligence V5 advisory-comment tools are descriptor-backed system-layer surfaces. Preview/readback are read-only; apply is approval-gated comment-only and forbids other repository mutations.'
)
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),
  `active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;
