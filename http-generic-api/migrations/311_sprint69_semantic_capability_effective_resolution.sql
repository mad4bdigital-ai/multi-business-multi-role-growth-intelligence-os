-- Sprint 69: Semantic capability registry and tenant-effective resolution foundation
--
-- Additive, shadow-first foundation. This migration does not expose a new
-- provider mutation surface and does not modify existing tenant tool exports.
-- Existing tools remain authoritative until a later governed cutover.

CREATE TABLE IF NOT EXISTS `platform_semantic_capabilities` (
  `capability_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `resource_type` VARCHAR(96) NOT NULL,
  `operation_key` VARCHAR(96) NOT NULL,
  `risk_class` VARCHAR(32) NOT NULL DEFAULT 'B',
  `default_execution_mode` VARCHAR(32) NOT NULL DEFAULT 'preview',
  `input_schema_json` LONGTEXT NULL,
  `output_schema_json` LONGTEXT NULL,
  `default_policy_key` VARCHAR(191) NULL,
  `requires_connection` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_workspace_authority` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_audit_evidence` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_readback` TINYINT(1) NOT NULL DEFAULT 0,
  `schema_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`capability_key`),
  KEY `idx_semantic_capability_status` (`status`, `risk_class`),
  KEY `idx_semantic_capability_resource_operation` (`resource_type`, `operation_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_provider_bindings` (
  `binding_id` VARCHAR(64) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `app_key` VARCHAR(128) NOT NULL,
  `parent_action_key` VARCHAR(191) NOT NULL,
  `endpoint_key` VARCHAR(191) NOT NULL,
  `adapter_key` VARCHAR(191) NULL,
  `policy_key` VARCHAR(191) NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `rollout_mode` VARCHAR(32) NOT NULL DEFAULT 'shadow',
  `connection_resolution_policy_json` LONGTEXT NULL,
  `input_mapping_json` LONGTEXT NULL,
  `output_mapping_json` LONGTEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_id`),
  UNIQUE KEY `uq_capability_provider_binding` (`capability_key`, `app_key`, `parent_action_key`, `endpoint_key`),
  KEY `idx_capability_binding_lookup` (`capability_key`, `status`, `rollout_mode`, `priority`),
  KEY `idx_capability_binding_app` (`app_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_endpoint_aliases` (
  `alias_id` VARCHAR(64) NOT NULL,
  `parent_action_key` VARCHAR(191) NOT NULL,
  `alias_endpoint_key` VARCHAR(191) NOT NULL,
  `canonical_endpoint_key` VARCHAR(191) NOT NULL,
  `alias_type` VARCHAR(64) NOT NULL DEFAULT 'legacy_endpoint_key',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `deprecated_at` DATETIME NULL,
  `sunset_at` DATETIME NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`alias_id`),
  UNIQUE KEY `uq_endpoint_alias` (`parent_action_key`, `alias_endpoint_key`),
  KEY `idx_endpoint_alias_canonical` (`parent_action_key`, `canonical_endpoint_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_capability_shadow_decisions` (
  `decision_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `workspace_id` VARCHAR(64) NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `resource_ref` VARCHAR(255) NULL,
  `legacy_decision` VARCHAR(96) NULL,
  `effective_decision` VARCHAR(96) NOT NULL,
  `difference_class` VARCHAR(96) NOT NULL DEFAULT 'not_compared',
  `decision_json` LONGTEXT NULL,
  `manifest_hash` VARCHAR(64) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`decision_id`),
  KEY `idx_capability_shadow_tenant` (`tenant_id`, `workspace_id`, `created_at`),
  KEY `idx_capability_shadow_capability` (`capability_key`, `difference_class`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_semantic_capabilities`
  (`capability_key`, `display_name`, `description`, `resource_type`, `operation_key`,
   `risk_class`, `default_execution_mode`, `requires_connection`,
   `requires_workspace_authority`, `requires_approval`, `requires_audit_evidence`,
   `requires_readback`, `status`, `notes`)
VALUES
  ('content.article.create_draft', 'Create article draft', 'Create a provider-backed content draft without publishing it.', 'content_article', 'create_draft', 'C', 'apply', 1, 1, 0, 1, 1, 'active', 'Initial WordPress shadow pilot capability.'),
  ('content.article.publish', 'Publish article', 'Publish an approved content article.', 'content_article', 'publish', 'D', 'apply', 1, 1, 1, 1, 1, 'active', 'No provider binding is activated by this migration.'),
  ('files.object.read', 'Read file object', 'Read a file object through a governed provider binding.', 'file_object', 'read', 'A', 'preview', 1, 1, 0, 1, 0, 'active', NULL),
  ('email.message.send', 'Send email message', 'Send a message through an approved tenant connection.', 'email_message', 'send', 'D', 'apply', 1, 1, 1, 1, 1, 'active', NULL),
  ('repository.read', 'Read repository', 'Read governed repository metadata or content.', 'repository', 'read', 'A', 'preview', 1, 1, 0, 1, 0, 'active', NULL),
  ('workflow.run', 'Run workflow', 'Run a governed workflow with its approval and runtime policy.', 'workflow', 'run', 'C', 'apply', 1, 1, 1, 1, 1, 'active', NULL),
  ('hosting.release.deploy', 'Deploy hosting release', 'Deploy an approved release to a governed hosting target.', 'hosting_release', 'deploy', 'D', 'apply', 1, 1, 1, 1, 1, 'active', NULL),
  ('analytics.read', 'Read analytics', 'Read governed analytics data.', 'analytics_dataset', 'read', 'A', 'preview', 1, 1, 0, 1, 0, 'active', NULL)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `resource_type` = VALUES(`resource_type`),
  `operation_key` = VALUES(`operation_key`),
  `risk_class` = VALUES(`risk_class`),
  `default_execution_mode` = VALUES(`default_execution_mode`),
  `requires_connection` = VALUES(`requires_connection`),
  `requires_workspace_authority` = VALUES(`requires_workspace_authority`),
  `requires_approval` = VALUES(`requires_approval`),
  `requires_audit_evidence` = VALUES(`requires_audit_evidence`),
  `requires_readback` = VALUES(`requires_readback`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_capability_provider_bindings`
  (`binding_id`, `capability_key`, `app_key`, `parent_action_key`, `endpoint_key`,
   `adapter_key`, `policy_key`, `priority`, `rollout_mode`,
   `connection_resolution_policy_json`, `input_mapping_json`, `status`, `notes`)
VALUES
  ('semantic-wordpress-create-draft-v1', 'content.article.create_draft', 'wordpress_rest',
   'wordpress_api', 'wordpress_create_post', 'wordpress_article_draft_adapter_v1',
   'wordpress_draft_only_v1', 100, 'shadow',
   JSON_OBJECT(
     'order', JSON_ARRAY('explicit_connection', 'workspace_validated_primary', 'workspace_validated_single'),
     'reject_ambiguous', true,
     'require_workspace_link', true,
     'require_validation_status', 'validated'
   ),
   JSON_OBJECT(
     'forced_fields', JSON_OBJECT('status', 'draft'),
     'blocked_fields', JSON_ARRAY('connection_id', 'endpoint_key', 'parent_action_key', 'authorization')
   ),
   'active',
   'Shadow-only pilot. Does not create or enable a tenant tool export.')
ON DUPLICATE KEY UPDATE
  `adapter_key` = VALUES(`adapter_key`),
  `policy_key` = VALUES(`policy_key`),
  `priority` = VALUES(`priority`),
  `rollout_mode` = VALUES(`rollout_mode`),
  `connection_resolution_policy_json` = VALUES(`connection_resolution_policy_json`),
  `input_mapping_json` = VALUES(`input_mapping_json`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_endpoint_aliases`
  (`alias_id`, `parent_action_key`, `alias_endpoint_key`, `canonical_endpoint_key`, `alias_type`, `status`, `deprecated_at`, `notes`)
VALUES
  ('wordpress-post-wp-v2-posts-alias', 'wordpress_api', 'postWpV2Posts', 'wordpress_create_post', 'imported_operation_key', 'active', CURRENT_TIMESTAMP, 'Compatibility alias for imported OpenAPI operation key.'),
  ('wordpress-create-post-operation-alias', 'wordpress_api', 'wordpressCreatePost', 'wordpress_create_post', 'operation_id', 'active', CURRENT_TIMESTAMP, 'Compatibility alias for historical operationId.')
ON DUPLICATE KEY UPDATE
  `canonical_endpoint_key` = VALUES(`canonical_endpoint_key`),
  `alias_type` = VALUES(`alias_type`),
  `status` = VALUES(`status`),
  `deprecated_at` = COALESCE(`platform_endpoint_aliases`.`deprecated_at`, VALUES(`deprecated_at`)),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_platform_endpoint_canonical_identity` AS
SELECT
  e.`id` AS source_endpoint_row_id,
  e.`endpoint_id`,
  e.`parent_action_key`,
  e.`endpoint_key` AS source_endpoint_key,
  COALESCE(a.`canonical_endpoint_key`, e.`endpoint_key`) AS canonical_endpoint_key,
  CASE WHEN a.`alias_endpoint_key` IS NULL THEN 0 ELSE 1 END AS alias_applied,
  a.`alias_type`,
  UPPER(TRIM(COALESCE(e.`method`, ''))) AS normalized_method,
  LOWER(TRIM(COALESCE(e.`endpoint_path_or_function`, ''))) AS normalized_path_or_function,
  SHA2(CONCAT_WS('|',
    LOWER(TRIM(COALESCE(e.`provider_family`, e.`connector_family`, 'unknown'))),
    UPPER(TRIM(COALESCE(e.`method`, ''))),
    LOWER(TRIM(COALESCE(e.`endpoint_path_or_function`, ''))),
    COALESCE(a.`canonical_endpoint_key`, e.`endpoint_key`)
  ), 256) AS canonical_execution_key,
  e.`status`,
  e.`execution_readiness`,
  e.`module_binding`,
  e.`connector_family`,
  e.`schema_json` IS NOT NULL AS schema_present
FROM `endpoints` e
LEFT JOIN `platform_endpoint_aliases` a
  ON a.`parent_action_key` = e.`parent_action_key`
 AND a.`alias_endpoint_key` = e.`endpoint_key`
 AND a.`status` = 'active';

CREATE OR REPLACE VIEW `v_platform_capability_export_projection` AS
SELECT
  CONCAT('semantic_capability.', b.`binding_id`) AS projection_key,
  c.`capability_key`,
  c.`display_name`,
  c.`risk_class`,
  b.`binding_id`,
  b.`app_key`,
  b.`parent_action_key`,
  b.`endpoint_key` AS configured_endpoint_key,
  COALESCE(a.`canonical_endpoint_key`, b.`endpoint_key`) AS canonical_endpoint_key,
  b.`rollout_mode`,
  CASE
    WHEN c.`status` <> 'active' OR b.`status` <> 'active' THEN 'disabled'
    WHEN b.`rollout_mode` = 'shadow' THEN 'shadow'
    WHEN e.`id` IS NULL THEN 'blocked_endpoint_missing'
    WHEN LOWER(COALESCE(e.`status`, '')) NOT IN ('active', 'ready', 'enabled') THEN 'blocked_endpoint_inactive'
    WHEN LOWER(COALESCE(e.`execution_readiness`, 'ready')) NOT IN ('ready', 'active', 'enabled') THEN 'blocked_endpoint_not_ready'
    ELSE 'ready_for_export'
  END AS desired_export_status,
  e.`id` AS source_endpoint_id,
  e.`method`,
  e.`endpoint_path_or_function`,
  e.`schema_json` IS NOT NULL AS schema_present,
  SHA2(CONCAT_WS('|', c.`capability_key`, b.`binding_id`, b.`rollout_mode`,
    COALESCE(a.`canonical_endpoint_key`, b.`endpoint_key`), c.`schema_version`,
    COALESCE(e.`updated_at`, '')), 256) AS manifest_hash
FROM `platform_semantic_capabilities` c
JOIN `platform_capability_provider_bindings` b
  ON b.`capability_key` = c.`capability_key`
LEFT JOIN `platform_endpoint_aliases` a
  ON a.`parent_action_key` = b.`parent_action_key`
 AND a.`alias_endpoint_key` = b.`endpoint_key`
 AND a.`status` = 'active'
LEFT JOIN `endpoints` e
  ON e.`parent_action_key` = b.`parent_action_key`
 AND e.`endpoint_key` = COALESCE(a.`canonical_endpoint_key`, b.`endpoint_key`)
 AND LOWER(COALESCE(e.`status`, '')) IN ('active', 'ready', 'enabled');

CREATE OR REPLACE VIEW `v_platform_capability_export_reconciliation` AS
SELECT
  p.*,
  x.`export_key` AS actual_export_key,
  x.`tool_name` AS actual_tool_name,
  x.`status` AS actual_export_status,
  CASE
    WHEN p.`desired_export_status` = 'shadow' AND x.`id` IS NULL THEN 'shadow_expected_no_export'
    WHEN p.`desired_export_status` = 'ready_for_export' AND x.`id` IS NULL THEN 'missing_export'
    WHEN p.`desired_export_status` LIKE 'blocked_%' AND x.`status` = 'active' THEN 'unsafe_active_export'
    WHEN x.`id` IS NOT NULL THEN 'aligned_or_legacy_export_present'
    ELSE 'not_applicable'
  END AS reconciliation_status
FROM `v_platform_capability_export_projection` p
LEFT JOIN `platform_endpoint_tool_exports` x
  ON x.`parent_action_key` = p.`parent_action_key`
 AND x.`endpoint_key` = p.`canonical_endpoint_key`;

CREATE OR REPLACE VIEW `v_tenant_effective_capability_candidates` AS
SELECT
  w.`tenant_id`,
  w.`workspace_id`,
  w.`workspace_key`,
  m.`user_id`,
  m.`role` AS membership_role,
  c.`capability_key`,
  c.`risk_class`,
  c.`requires_connection`,
  c.`requires_workspace_authority`,
  c.`requires_approval`,
  c.`requires_readback`,
  b.`binding_id`,
  b.`app_key`,
  b.`parent_action_key`,
  b.`endpoint_key` AS configured_endpoint_key,
  COALESCE(a.`canonical_endpoint_key`, b.`endpoint_key`) AS canonical_endpoint_key,
  b.`rollout_mode`,
  wal.`link_id`,
  uac.`connection_id`,
  uac.`status` AS connection_status,
  uac.`validation_status`,
  uac.`is_primary`,
  aag.`grant_id` AS action_grant_id,
  wrg.`grant_id` AS resource_grant_id,
  wrg.`permission` AS resource_permission,
  e.`id` AS endpoint_row_id,
  e.`execution_readiness`,
  CASE
    WHEN w.`bootstrap_status` <> 'ready' THEN 'workspace_not_ready'
    WHEN wal.`link_id` IS NULL AND c.`requires_connection` = 1 THEN 'workspace_connection_link_missing'
    WHEN uac.`connection_id` IS NULL AND c.`requires_connection` = 1 THEN 'connection_missing'
    WHEN uac.`status` <> 'active' THEN 'connection_inactive'
    WHEN LOWER(COALESCE(uac.`validation_status`, '')) <> 'validated' THEN 'connection_not_validated'
    WHEN aag.`grant_id` IS NULL THEN 'capability_grant_missing'
    WHEN c.`requires_workspace_authority` = 1 AND wrg.`grant_id` IS NULL THEN 'resource_authority_missing'
    WHEN e.`id` IS NULL THEN 'canonical_endpoint_unavailable'
    WHEN b.`rollout_mode` = 'shadow' THEN 'shadow_ready'
    WHEN b.`rollout_mode` = 'canary' THEN 'canary_ready'
    WHEN b.`rollout_mode` = 'active' THEN 'ready'
    ELSE 'binding_disabled'
  END AS effective_status,
  CASE
    WHEN uac.`connection_id` IS NULL THEN 0
    WHEN LOWER(COALESCE(uac.`validation_status`, '')) = 'validated' AND uac.`is_primary` = 1 THEN 900
    WHEN LOWER(COALESCE(uac.`validation_status`, '')) = 'validated' THEN 800
    WHEN uac.`status` = 'active' AND uac.`is_primary` = 1 THEN 600
    WHEN uac.`status` = 'active' THEN 500
    ELSE 0
  END AS connection_rank_score
FROM `workspace_registry` w
JOIN `memberships` m
  ON m.`tenant_id` = w.`tenant_id`
 AND m.`status` = 'active'
JOIN `platform_semantic_capabilities` c
  ON c.`status` = 'active'
JOIN `platform_capability_provider_bindings` b
  ON b.`capability_key` = c.`capability_key`
 AND b.`status` = 'active'
 AND b.`rollout_mode` <> 'disabled'
LEFT JOIN `platform_endpoint_aliases` a
  ON a.`parent_action_key` = b.`parent_action_key`
 AND a.`alias_endpoint_key` = b.`endpoint_key`
 AND a.`status` = 'active'
LEFT JOIN `workspace_app_links` wal
  ON CONVERT(wal.`workspace_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
   = CONVERT(w.`workspace_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND CONVERT(wal.`tenant_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
   = CONVERT(w.`tenant_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND wal.`app_key` = b.`app_key`
 AND wal.`status` = 'active'
LEFT JOIN `user_app_connections` uac
  ON uac.`connection_id` = wal.`connection_id`
 AND uac.`tenant_id` = w.`tenant_id`
LEFT JOIN `app_action_grants` aag
  ON CONVERT(aag.`workspace_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
   = CONVERT(w.`workspace_id` USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND aag.`connection_id` = uac.`connection_id`
 AND aag.`app_key` = b.`app_key`
 AND aag.`action_key` = b.`parent_action_key`
 AND aag.`status` = 'active'
 AND (aag.`expires_at` IS NULL OR aag.`expires_at` > NOW())
LEFT JOIN `workspace_resource_grants` wrg
  ON wrg.`tenant_id` = w.`tenant_id`
 AND wrg.`grantee_user_id` = m.`user_id`
 AND wrg.`status` = 'active'
 AND (wrg.`expires_at` IS NULL OR wrg.`expires_at` > NOW())
 AND wrg.`resource_type` = 'workspace'
 AND wrg.`resource_ref` IN (w.`workspace_id`, w.`tenant_id`)
LEFT JOIN `endpoints` e
  ON e.`parent_action_key` = b.`parent_action_key`
 AND e.`endpoint_key` = COALESCE(a.`canonical_endpoint_key`, b.`endpoint_key`)
 AND LOWER(COALESCE(e.`status`, '')) IN ('active', 'ready', 'enabled')
 AND LOWER(COALESCE(e.`execution_readiness`, 'ready')) IN ('ready', 'active', 'enabled');
