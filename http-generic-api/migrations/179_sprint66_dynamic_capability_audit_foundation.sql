-- Sprint 66: Dynamic capability and audit foundation.
--
-- Additive compatibility layer only. These tables and views make current
-- platform capabilities, evidence gaps, and audit inputs queryable without
-- enabling new tenant routes, direct apply executors, or continuous watchers.

CREATE TABLE IF NOT EXISTS `platform_audit_event_bus` (
  `event_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_key` VARCHAR(191) NOT NULL,
  `source_family` VARCHAR(80) NOT NULL,
  `source_key` VARCHAR(191) NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `resource_kind` VARCHAR(80) NULL,
  `resource_key` VARCHAR(255) NULL,
  `event_status` ENUM('observed','pending_rollup','rolled_up','ignored','failed') NOT NULL DEFAULT 'observed',
  `evidence_json` JSON NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  UNIQUE KEY `uq_platform_audit_event_key` (`event_key`),
  KEY `idx_platform_audit_event_source` (`source_family`, `source_key`),
  KEY `idx_platform_audit_event_resource` (`resource_kind`, `resource_key`),
  KEY `idx_platform_audit_event_status` (`event_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `repo_file_audit_runs` (
  `run_id` VARCHAR(64) NOT NULL,
  `repo_owner` VARCHAR(128) NULL,
  `repo_name` VARCHAR(191) NOT NULL,
  `branch_name` VARCHAR(191) NULL,
  `commit_sha` VARCHAR(64) NULL,
  `audit_scope` VARCHAR(80) NOT NULL DEFAULT 'repo_current_main',
  `source_event_key` VARCHAR(191) NULL,
  `run_status` ENUM('planned','running','completed','failed','superseded') NOT NULL DEFAULT 'planned',
  `summary_json` JSON NULL,
  `evidence_json` JSON NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`),
  KEY `idx_repo_file_audit_repo_sha` (`repo_name`, `commit_sha`),
  KEY `idx_repo_file_audit_status` (`run_status`, `created_at`),
  KEY `idx_repo_file_audit_event` (`source_event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `repo_file_audit_findings` (
  `finding_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` VARCHAR(64) NOT NULL,
  `file_path` VARCHAR(768) NOT NULL,
  `file_status` ENUM('complete','needs_follow_up','missing','generated_index','manual_review','not_applicable') NOT NULL DEFAULT 'manual_review',
  `finding_type` VARCHAR(80) NOT NULL DEFAULT 'status',
  `risk_level` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `next_action` TEXT NULL,
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`finding_id`),
  KEY `idx_repo_file_audit_finding_run` (`run_id`),
  KEY `idx_repo_file_audit_finding_path` (`file_path`(191)),
  KEY `idx_repo_file_audit_finding_status` (`file_status`, `risk_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `asset_audit_events` (
  `asset_event_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_key` VARCHAR(80) NOT NULL,
  `asset_id` VARCHAR(255) NULL,
  `asset_path` VARCHAR(768) NULL,
  `source_event_key` VARCHAR(191) NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `change_status` ENUM('observed','readback_verified','pending_review','ignored','failed') NOT NULL DEFAULT 'observed',
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`asset_event_id`),
  KEY `idx_asset_audit_provider_asset` (`provider_key`, `asset_id`),
  KEY `idx_asset_audit_event` (`source_event_key`),
  KEY `idx_asset_audit_status` (`change_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `db_change_audit_events` (
  `db_event_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_family` VARCHAR(80) NOT NULL,
  `database_name` VARCHAR(191) NULL,
  `table_name` VARCHAR(191) NOT NULL,
  `mutation_class` ENUM('schema','insert','update','delete','bulk','unknown') NOT NULL DEFAULT 'unknown',
  `governed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_event_key` VARCHAR(191) NULL,
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`db_event_id`),
  KEY `idx_db_change_audit_table` (`table_name`, `mutation_class`),
  KEY `idx_db_change_audit_governed` (`governed`, `created_at`),
  KEY `idx_db_change_audit_event` (`source_event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checkpoint_auto_rollups` (
  `rollup_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_event_key` VARCHAR(191) NOT NULL,
  `checkpoint_id` VARCHAR(64) NULL,
  `trigger_family` VARCHAR(80) NOT NULL,
  `commit_sha` VARCHAR(64) NULL,
  `rollup_status` ENUM('planned','ready','written','failed','skipped') NOT NULL DEFAULT 'planned',
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rollup_id`),
  UNIQUE KEY `uq_checkpoint_auto_rollup_event` (`source_event_key`),
  KEY `idx_checkpoint_auto_rollup_status` (`rollup_status`, `created_at`),
  KEY `idx_checkpoint_auto_rollup_sha` (`commit_sha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_platform_capabilities_current` AS
SELECT
  CONCAT('admin_tool.', t.tool_key) AS capability_key,
  t.display_name,
  'admin_tool' AS capability_family,
  'admin_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE
    WHEN COALESCE(t.tags, '') LIKE '%diagnostic%' THEN 'diagnostic'
    WHEN UPPER(t.http_method) = 'GET' OR COALESCE(t.tags, '') LIKE '%read_only%' THEN 'read'
    WHEN COALESCE(t.tags, '') LIKE '%state_changing%' THEN 'state_changing'
    ELSE 'tool_dispatch'
  END AS operation_class,
  CASE
    WHEN COALESCE(t.tags, '') LIKE '%security%' OR COALESCE(t.tags, '') LIKE '%secret%' THEN 'D'
    WHEN COALESCE(t.tags, '') LIKE '%state_changing%' THEN 'C'
    WHEN UPPER(t.http_method) = 'GET' OR COALESCE(t.tags, '') LIKE '%read_only%' THEN 'A'
    ELSE 'B'
  END AS risk_class,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END AS runtime_status,
  'admin' AS exposure_scope,
  CASE WHEN COALESCE(t.tags, '') LIKE '%state_changing%' OR COALESCE(t.tags, '') LIKE '%security%' OR UPPER(t.http_method) NOT IN ('GET', 'HEAD') THEN 1 ELSE 0 END AS resource_authority_required,
  CASE WHEN t.is_enabled = 1 THEN 1 ELSE 0 END AS dispatch_allowed,
  0 AS apply_allowed,
  CASE WHEN UPPER(t.http_method) NOT IN ('GET', 'HEAD') OR COALESCE(t.tags, '') LIKE '%state_changing%' THEN 1 ELSE 0 END AS requires_audit_evidence,
  CASE WHEN UPPER(t.http_method) NOT IN ('GET', 'HEAD') OR COALESCE(t.tags, '') LIKE '%state_changing%' THEN 1 ELSE 0 END AS requires_readback,
  NULL AS evidence_ref,
  t.description AS notes
FROM `admin_platform_endpoint_tools` t
UNION ALL
SELECT
  CONCAT('tenant_tool.', t.tool_key),
  t.display_name,
  'tenant_tool',
  'tenant_platform_endpoint_tools',
  CAST(t.tool_key AS CHAR(255)),
  CASE
    WHEN COALESCE(t.tags, '') LIKE '%diagnostic%' THEN 'diagnostic'
    WHEN UPPER(t.http_method) = 'GET' OR COALESCE(t.tags, '') LIKE '%read_only%' THEN 'read'
    ELSE 'tenant_tool_dispatch'
  END,
  CASE
    WHEN COALESCE(t.tags, '') LIKE '%state_changing%' THEN 'C'
    WHEN UPPER(t.http_method) = 'GET' OR COALESCE(t.tags, '') LIKE '%read_only%' THEN 'A'
    ELSE 'B'
  END,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END,
  'tenant',
  CASE WHEN UPPER(t.http_method) NOT IN ('GET', 'HEAD') OR COALESCE(t.tags, '') LIKE '%state_changing%' THEN 1 ELSE 0 END,
  CASE WHEN t.is_enabled = 1 THEN 1 ELSE 0 END,
  0,
  CASE WHEN UPPER(t.http_method) NOT IN ('GET', 'HEAD') OR COALESCE(t.tags, '') LIKE '%state_changing%' THEN 1 ELSE 0 END,
  CASE WHEN UPPER(t.http_method) NOT IN ('GET', 'HEAD') OR COALESCE(t.tags, '') LIKE '%state_changing%' THEN 1 ELSE 0 END,
  NULL,
  t.description
FROM `tenant_platform_endpoint_tools` t
UNION ALL
SELECT
  CONCAT('engine.', e.engine_key),
  e.display_name,
  e.engine_type,
  'platform_engine_registry',
  CAST(e.engine_key AS CHAR(255)),
  'engine_runtime',
  CASE WHEN e.status = 'active' THEN 'B' ELSE 'C' END,
  e.status,
  'internal',
  0,
  CASE WHEN e.status = 'active' THEN 1 ELSE 0 END,
  0,
  1,
  1,
  e.default_policy_key,
  e.notes
FROM `platform_engine_registry` e
UNION ALL
SELECT
  CONCAT('resource_authority_route_family.', r.route_family_key),
  r.display_name,
  r.route_family,
  'resource_authority_route_family_registry',
  CAST(r.route_family_key AS CHAR(255)),
  r.operation_class,
  r.risk_class,
  r.enforcement_status,
  'internal',
  r.resource_authority_required,
  r.apply_allowed_default,
  r.apply_allowed_default,
  r.audit_required,
  r.readback_required,
  r.authority_requirement_key,
  r.notes
FROM `resource_authority_route_family_registry` r
UNION ALL
SELECT
  CONCAT('runtime_dispatch_certification.', c.certification_key),
  c.surface_key,
  c.surface_family,
  'runtime_dispatch_certification_registry',
  CAST(c.certification_key AS CHAR(255)),
  c.smoke_strategy,
  c.risk_class,
  c.certification_status,
  'internal',
  c.requires_resource_authority,
  c.dispatch_allowed,
  c.apply_allowed,
  c.requires_audit_evidence,
  c.requires_readback,
  c.last_evidence_ref,
  c.notes
FROM `runtime_dispatch_certification_registry` c
UNION ALL
SELECT
  CONCAT('plugin_contribution.', p.contribution_id),
  p.display_name,
  p.plugin_type,
  'platform_plugin_contributions',
  CAST(p.contribution_id AS CHAR(255)),
  'plugin_contribution',
  CASE WHEN p.target IN ('marketplace_candidate','platform_base_candidate') THEN 'C' ELSE 'B' END,
  p.certification_status,
  p.owner_scope,
  1,
  CASE WHEN p.status = 'certified' THEN 1 ELSE 0 END,
  0,
  1,
  1,
  p.plugin_key,
  p.notes
FROM `platform_plugin_contributions` p;

CREATE OR REPLACE VIEW `v_platform_bindings_current` AS
SELECT
  b.binding_id AS binding_key,
  CASE
    WHEN b.tool_surface = 'tenant_platform_tool' THEN CONCAT('tenant_tool.', b.tool_key)
    WHEN b.tool_surface = 'platform_endpoint_export' THEN CONCAT('platform_endpoint_export.', b.tool_key)
    WHEN b.tool_surface IN ('device_tool','virtual_tool','admin_platform_tool') THEN CONCAT('admin_tool.', b.tool_key)
    ELSE CONCAT(b.tool_surface, '.', b.tool_key)
  END AS capability_key,
  b.binding_role AS binding_family,
  'app_integration_tool_bindings' AS source_table,
  CAST(b.id AS CHAR(255)) AS source_key,
  b.status AS binding_status,
  b.exposure_scope,
  b.credential_source,
  CASE WHEN b.status = 'active' THEN 1 ELSE 0 END AS dispatch_allowed,
  0 AS apply_allowed,
  b.notes
FROM `app_integration_tool_bindings` b
UNION ALL
SELECT
  p.policy_key,
  CONCAT('engine.', p.engine_key),
  'engine_policy',
  'platform_engine_policy_registry',
  CAST(p.policy_key AS CHAR(255)),
  p.status,
  p.scope_type,
  'none',
  CASE WHEN p.status = 'active' THEN 1 ELSE 0 END,
  CASE WHEN p.mode = 'apply_allowed' THEN 1 ELSE 0 END,
  p.notes
FROM `platform_engine_policy_registry` p
WHERE p.engine_key IS NOT NULL
UNION ALL
SELECT
  c.certification_key,
  CONCAT('runtime_dispatch_certification.', c.certification_key),
  'dispatch_certification',
  'runtime_dispatch_certification_registry',
  CAST(c.certification_key AS CHAR(255)),
  c.certification_status,
  'internal',
  'none',
  c.dispatch_allowed,
  c.apply_allowed,
  c.notes
FROM `runtime_dispatch_certification_registry` c;

CREATE OR REPLACE VIEW `v_platform_exports_current` AS
SELECT
  CONCAT('admin_tool_export.', t.tool_key) AS export_key,
  CONCAT('admin_tool.', t.tool_key) AS capability_key,
  'admin_platform_tool' AS export_surface,
  'admin_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'admin' AS exposure_scope,
  t.http_method,
  t.http_path,
  t.description AS notes
FROM `admin_platform_endpoint_tools` t
UNION ALL
SELECT
  CONCAT('tenant_tool_export.', t.tool_key),
  CONCAT('tenant_tool.', t.tool_key),
  'tenant_platform_tool',
  'tenant_platform_endpoint_tools',
  CAST(t.tool_key AS CHAR(255)),
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END,
  'tenant',
  t.http_method,
  t.http_path,
  t.description
FROM `tenant_platform_endpoint_tools` t;

CREATE OR REPLACE VIEW `v_platform_capability_maturity` AS
SELECT
  c.capability_key,
  c.display_name,
  c.capability_family,
  c.source_table,
  c.source_key,
  c.operation_class,
  c.risk_class,
  c.runtime_status,
  c.exposure_scope,
  c.resource_authority_required,
  c.dispatch_allowed,
  c.apply_allowed,
  CASE
    WHEN c.runtime_status IN ('active','available','read_only_certified','diagnostic_certified','certified') THEN
      LEAST(10,
        2
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 2 ELSE 0 END
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key AND b.binding_status IN ('active','read_only_certified','diagnostic_certified','certified')) THEN 2 ELSE 0 END
        + CASE WHEN c.dispatch_allowed = 1 THEN 2 ELSE 0 END
        + CASE WHEN c.resource_authority_required = 0 OR c.evidence_ref IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN c.requires_audit_evidence = 0 OR c.requires_readback = 1 THEN 1 ELSE 0 END
      )
    ELSE
      LEAST(10,
        1
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 1 ELSE 0 END
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key) THEN 1 ELSE 0 END
      )
  END AS maturity_score,
  CASE
    WHEN c.runtime_status IN ('read_only_certified','diagnostic_certified','certified') THEN 'certified'
    WHEN c.dispatch_allowed = 1 AND EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 'exported'
    WHEN c.dispatch_allowed = 1 THEN 'runtime_exists'
    WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key) THEN 'policy_or_binding_exists'
    ELSE 'registered'
  END AS maturity_status,
  CONCAT_WS(',',
    CASE WHEN c.dispatch_allowed = 0 THEN 'dispatch_not_allowed' END,
    CASE WHEN c.resource_authority_required = 1 AND c.evidence_ref IS NULL THEN 'authority_evidence_missing' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 'active_export_missing' END,
    CASE WHEN c.requires_audit_evidence = 1 AND c.requires_readback = 0 THEN 'readback_missing' END
  ) AS gap_flags
FROM `v_platform_capabilities_current` c;

CREATE OR REPLACE VIEW `v_platform_capability_gaps` AS
SELECT
  capability_key,
  'dispatch_not_allowed' AS gap_key,
  CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END AS gap_severity,
  'Capability is registered but dispatch is not currently allowed.' AS gap_description
FROM `v_platform_capabilities_current`
WHERE dispatch_allowed = 0
UNION ALL
SELECT
  capability_key,
  'authority_evidence_missing',
  CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END,
  'Capability requires resource authority evidence before mutation or certification.'
FROM `v_platform_capabilities_current`
WHERE resource_authority_required = 1
  AND evidence_ref IS NULL
UNION ALL
SELECT
  c.capability_key,
  'active_export_missing',
  'low',
  'Capability has no active export row in the compatibility export view.'
FROM `v_platform_capabilities_current` c
WHERE NOT EXISTS (
  SELECT 1
  FROM `v_platform_exports_current` x
  WHERE x.capability_key = c.capability_key
    AND x.export_status = 'active'
);
