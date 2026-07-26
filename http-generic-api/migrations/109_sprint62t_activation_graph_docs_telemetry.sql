-- Sprint 62t: Activation graph context docs, telemetry, and doctrine seeds
-- Summary-only graph assets; no secret values.

CREATE TABLE IF NOT EXISTS `graph_memory_usage_events` (
  `event_id` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(96) NOT NULL,
  `surface` VARCHAR(120) NOT NULL,
  `usage_label` VARCHAR(120) NOT NULL,
  `parent_action_key` VARCHAR(160) NULL,
  `endpoint_key` VARCHAR(160) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(64) NULL,
  `device_id` VARCHAR(160) NULL,
  `requested` TINYINT(1) NOT NULL DEFAULT 0,
  `resolved` TINYINT(1) NOT NULL DEFAULT 0,
  `asset_count` INT NOT NULL DEFAULT 0,
  `asset_keys_json` JSON NULL,
  `mode_hints_json` JSON NULL,
  `selection_policy_json` JSON NULL,
  `error_json` JSON NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_graph_memory_usage_surface` (`surface`, `usage_label`, `created_at`),
  KEY `idx_graph_memory_usage_tenant` (`tenant_id`, `created_at`),
  KEY `idx_graph_memory_usage_endpoint` (`parent_action_key`, `endpoint_key`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `json_assets`
  (`asset_id`, `brand_name`, `asset_key`, `asset_type`, `mapping_status`, `mapping_version`, `storage_format`, `source_mode`, `source_asset_ref`, `json_payload`, `transport_status`, `validation_status`, `last_validated_at`, `notes`, `active_status`)
VALUES
  ('activation_managed_flow_doctrine_20260522', 'platform', 'activation_managed_flow_doctrine', 'activation_doctrine', 'mapped', '2026-05-22', 'json', 'sql_seed', 'migration_109', JSON_OBJECT('status','validated','topic','managed activation flow','scope','platform.activation','generalized_rules', JSON_ARRAY('Managed mode is the default for new tenants unless the user asks for tenant-owned integrations.', 'Managed activation may use platform-owned provider credentials where policy allows.', 'Activation graph context is advisory only and must not replace same-cycle validation.'), 'regression_checklist', JSON_ARRAY('mode remains managed/dedicated only', 'secrets_included=false', 'applied_to_authority=false')), 'available', 'validated', '2026-05-22T00:00:00Z', 'Safe summary-only doctrine for managed activation graph context.', 'active'),
  ('activation_dedicated_flow_doctrine_20260522', 'platform', 'activation_dedicated_flow_doctrine', 'activation_doctrine', 'mapped', '2026-05-22', 'json', 'sql_seed', 'migration_109', JSON_OBJECT('status','validated','topic','dedicated activation flow','scope','platform.activation','generalized_rules', JSON_ARRAY('Dedicated mode requires tenant-owned required integrations before device install.', 'Credential intake must happen through secure intake links, not chat.', 'Missing required integrations should return dedicated_integrations_required rather than falling back silently.'), 'regression_checklist', JSON_ARRAY('cloudflare readiness checked', 'hostinger readiness checked', 'no credential values in response')), 'available', 'validated', '2026-05-22T00:00:00Z', 'Safe summary-only doctrine for dedicated activation graph context.', 'active'),
  ('activation_hybrid_integration_policy_doctrine_20260522', 'platform', 'activation_hybrid_integration_policy_doctrine', 'activation_doctrine', 'mapped', '2026-05-22', 'json', 'sql_seed', 'migration_109', JSON_OBJECT('status','validated','topic','hybrid per-app integration policy','scope','platform.activation','generalized_rules', JSON_ARRAY('There is no third activation mode named hybrid.', 'Mixed behavior is configured per app through integration_modes.', 'Dedicated per-app modes require active tenant-owned user_app_connections.'), 'regression_checklist', JSON_ARRAY('connect_activate required mode managed/dedicated', 'connect_integration_policy_update carries integration_modes', 'tenant MCP schema remains meta-operation only')), 'available', 'validated', '2026-05-22T00:00:00Z', 'Safe summary-only doctrine for mixed integration policy.', 'active'),
  ('activation_device_install_prerequisites_doctrine_20260522', 'platform', 'activation_device_install_prerequisites_doctrine', 'activation_doctrine', 'mapped', '2026-05-22', 'json', 'sql_seed', 'migration_109', JSON_OBJECT('status','validated','topic','device install prerequisites','scope','platform.activation','generalized_rules', JSON_ARRAY('Device install requires stable device_id and tenant context.', 'Dedicated required integrations can block device install until ready.', 'Local connector reachability checks remain governed and tenant-scoped.'), 'regression_checklist', JSON_ARRAY('device_id stable lowercase/hyphen', 'dedicated_integrations_required handled', 'connector secrets never returned')), 'available', 'validated', '2026-05-22T00:00:00Z', 'Safe summary-only doctrine for device activation/install prerequisites.', 'active'),
  ('activation_graph_context_boundary_doctrine_20260522', 'platform', 'activation_graph_context_boundary_doctrine', 'activation_doctrine', 'mapped', '2026-05-22', 'json', 'sql_seed', 'migration_109', JSON_OBJECT('status','validated','topic','activation graph context boundary','scope','platform.activation','generalized_rules', JSON_ARRAY('activation_graph_context is advisory only.', 'Authority remains tables plus same-cycle validation.', 'Graph context may explain next steps but must not mint active/recovered status.'), 'regression_checklist', JSON_ARRAY('applied_to_authority=false', 'summary_only', 'secrets_included=false')), 'available', 'validated', '2026-05-22T00:00:00Z', 'Safe summary-only boundary doctrine for activation graph context.', 'active')
ON DUPLICATE KEY UPDATE
  `asset_key` = VALUES(`asset_key`),
  `asset_type` = VALUES(`asset_type`),
  `json_payload` = VALUES(`json_payload`),
  `validation_status` = VALUES(`validation_status`),
  `notes` = VALUES(`notes`),
  `active_status` = VALUES(`active_status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `json_asset_subject_links`
  (`link_id`, `asset_id`, `asset_key`, `subject_type`, `subject_ref`, `subject_key`, `linkage_type`, `scope_label`, `metadata_json`, `status`)
VALUES
  ('link_activation_managed_flow_platform', 'activation_managed_flow_doctrine_20260522', 'activation_managed_flow_doctrine', 'platform', 'platform:global', 'platform.global', 'scope_attachment', 'activation', JSON_OBJECT('usage','activation_resolver_advisory'), 'active'),
  ('link_activation_dedicated_flow_platform', 'activation_dedicated_flow_doctrine_20260522', 'activation_dedicated_flow_doctrine', 'platform', 'platform:global', 'platform.global', 'scope_attachment', 'activation', JSON_OBJECT('usage','activation_resolver_advisory'), 'active'),
  ('link_activation_hybrid_policy_platform', 'activation_hybrid_integration_policy_doctrine_20260522', 'activation_hybrid_integration_policy_doctrine', 'platform', 'platform:global', 'platform.global', 'scope_attachment', 'activation', JSON_OBJECT('usage','activation_resolver_advisory'), 'active'),
  ('link_activation_device_install_platform', 'activation_device_install_prerequisites_doctrine_20260522', 'activation_device_install_prerequisites_doctrine', 'platform', 'platform:global', 'platform.global', 'scope_attachment', 'activation', JSON_OBJECT('usage','activation_resolver_advisory'), 'active'),
  ('link_activation_graph_boundary_platform', 'activation_graph_context_boundary_doctrine_20260522', 'activation_graph_context_boundary_doctrine', 'platform', 'platform:global', 'platform.global', 'scope_attachment', 'activation', JSON_OBJECT('usage','activation_resolver_advisory'), 'active')
ON DUPLICATE KEY UPDATE
  `asset_key` = VALUES(`asset_key`),
  `scope_label` = VALUES(`scope_label`),
  `metadata_json` = VALUES(`metadata_json`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_graph_nodes`
  (`node_id`, `node_type`, `node_label`, `scope_type`, `subject_ref`, `source_table`, `source_pk`, `authority_status`, `lifecycle_status`, `visibility_scope`, `sensitivity`, `evidence_level`, `runtime_role`, `source_system`, `metadata_json`)
VALUES
  ('platform.global', 'platform', 'Platform Global', 'platform', 'platform:global', NULL, NULL, 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'authority', 'sql', JSON_OBJECT('seed','activation_graph_context')),
  ('json_asset.activation_managed_flow_doctrine_20260522', 'json_asset', 'activation_managed_flow_doctrine', 'platform', 'activation_managed_flow_doctrine_20260522', 'json_assets', 'activation_managed_flow_doctrine_20260522', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 'sql', JSON_OBJECT('asset_key','activation_managed_flow_doctrine')),
  ('json_asset.activation_dedicated_flow_doctrine_20260522', 'json_asset', 'activation_dedicated_flow_doctrine', 'platform', 'activation_dedicated_flow_doctrine_20260522', 'json_assets', 'activation_dedicated_flow_doctrine_20260522', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 'sql', JSON_OBJECT('asset_key','activation_dedicated_flow_doctrine')),
  ('json_asset.activation_hybrid_integration_policy_doctrine_20260522', 'json_asset', 'activation_hybrid_integration_policy_doctrine', 'platform', 'activation_hybrid_integration_policy_doctrine_20260522', 'json_assets', 'activation_hybrid_integration_policy_doctrine_20260522', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 'sql', JSON_OBJECT('asset_key','activation_hybrid_integration_policy_doctrine')),
  ('json_asset.activation_device_install_prerequisites_doctrine_20260522', 'json_asset', 'activation_device_install_prerequisites_doctrine', 'platform', 'activation_device_install_prerequisites_doctrine_20260522', 'json_assets', 'activation_device_install_prerequisites_doctrine_20260522', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 'sql', JSON_OBJECT('asset_key','activation_device_install_prerequisites_doctrine')),
  ('json_asset.activation_graph_context_boundary_doctrine_20260522', 'json_asset', 'activation_graph_context_boundary_doctrine', 'platform', 'activation_graph_context_boundary_doctrine_20260522', 'json_assets', 'activation_graph_context_boundary_doctrine_20260522', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 'sql', JSON_OBJECT('asset_key','activation_graph_context_boundary_doctrine'))
ON DUPLICATE KEY UPDATE
  `node_label` = VALUES(`node_label`),
  `authority_status` = VALUES(`authority_status`),
  `lifecycle_status` = VALUES(`lifecycle_status`),
  `runtime_role` = VALUES(`runtime_role`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_graph_edges`
  (`edge_id`, `source_node_id`, `edge_type`, `target_node_id`, `scope_type`, `authority_status`, `lifecycle_status`, `visibility_scope`, `sensitivity`, `evidence_level`, `runtime_role`, `runtime_enforced`, `source_table`, `source_pk`, `metadata_json`)
VALUES
  ('edge.activation_managed_flow_platform', 'json_asset.activation_managed_flow_doctrine_20260522', 'attached_to', 'platform.global', 'platform', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 1, 'json_asset_subject_links', 'link_activation_managed_flow_platform', JSON_OBJECT('usage','activation_resolver_advisory')),
  ('edge.activation_dedicated_flow_platform', 'json_asset.activation_dedicated_flow_doctrine_20260522', 'attached_to', 'platform.global', 'platform', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 1, 'json_asset_subject_links', 'link_activation_dedicated_flow_platform', JSON_OBJECT('usage','activation_resolver_advisory')),
  ('edge.activation_hybrid_policy_platform', 'json_asset.activation_hybrid_integration_policy_doctrine_20260522', 'attached_to', 'platform.global', 'platform', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 1, 'json_asset_subject_links', 'link_activation_hybrid_policy_platform', JSON_OBJECT('usage','activation_resolver_advisory')),
  ('edge.activation_device_install_platform', 'json_asset.activation_device_install_prerequisites_doctrine_20260522', 'attached_to', 'platform.global', 'platform', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 1, 'json_asset_subject_links', 'link_activation_device_install_platform', JSON_OBJECT('usage','activation_resolver_advisory')),
  ('edge.activation_graph_boundary_platform', 'json_asset.activation_graph_context_boundary_doctrine_20260522', 'attached_to', 'platform.global', 'platform', 'authoritative', 'active', 'platform_admin', 'internal', 'declared', 'resolver_input', 1, 'json_asset_subject_links', 'link_activation_graph_boundary_platform', JSON_OBJECT('usage','activation_resolver_advisory'))
ON DUPLICATE KEY UPDATE
  `lifecycle_status` = VALUES(`lifecycle_status`),
  `runtime_role` = VALUES(`runtime_role`),
  `runtime_enforced` = VALUES(`runtime_enforced`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
