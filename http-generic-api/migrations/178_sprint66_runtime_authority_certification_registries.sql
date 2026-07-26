-- Sprint 66: Runtime authority and dispatch certification registries.
-- Adds read-only governance foundations for route-family resource authority
-- and generic runtime dispatch certification without enabling broad enforcement.
-- Additive only. No destructive SQL.

CREATE TABLE IF NOT EXISTS `resource_authority_route_family_registry` (
  `route_family_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `route_family` VARCHAR(128) NOT NULL,
  `operation_class` VARCHAR(64) NOT NULL,
  `risk_class` VARCHAR(8) NOT NULL,
  `resource_authority_required` TINYINT(1) NOT NULL DEFAULT 1,
  `authority_requirement_key` VARCHAR(191) NULL,
  `dry_run_required` TINYINT(1) NOT NULL DEFAULT 1,
  `audit_required` TINYINT(1) NOT NULL DEFAULT 1,
  `readback_required` TINYINT(1) NOT NULL DEFAULT 1,
  `apply_allowed_default` TINYINT(1) NOT NULL DEFAULT 0,
  `enforcement_status` VARCHAR(64) NOT NULL DEFAULT 'baseline_registered',
  `runtime_surface` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`route_family_key`),
  KEY `idx_resource_authority_route_family` (`route_family`),
  KEY `idx_resource_authority_risk_class` (`risk_class`),
  KEY `idx_resource_authority_enforcement_status` (`enforcement_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `runtime_dispatch_certification_registry` (
  `certification_key` VARCHAR(191) NOT NULL,
  `surface_key` VARCHAR(191) NOT NULL,
  `surface_family` VARCHAR(128) NOT NULL,
  `tool_or_action_key` VARCHAR(191) NULL,
  `risk_class` VARCHAR(8) NOT NULL,
  `certification_status` VARCHAR(64) NOT NULL DEFAULT 'baseline_registered',
  `smoke_strategy` VARCHAR(128) NOT NULL,
  `dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_resource_authority` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_dry_run` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_audit_evidence` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_readback` TINYINT(1) NOT NULL DEFAULT 1,
  `last_evidence_ref` VARCHAR(255) NULL,
  `last_certified_at` TIMESTAMP NULL DEFAULT NULL,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`certification_key`),
  KEY `idx_runtime_dispatch_surface` (`surface_family`, `surface_key`),
  KEY `idx_runtime_dispatch_tool` (`tool_or_action_key`),
  KEY `idx_runtime_dispatch_status` (`certification_status`),
  KEY `idx_runtime_dispatch_risk_class` (`risk_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `resource_authority_route_family_registry`
  (`route_family_key`, `display_name`, `route_family`, `operation_class`, `risk_class`, `resource_authority_required`, `authority_requirement_key`, `dry_run_required`, `audit_required`, `readback_required`, `apply_allowed_default`, `enforcement_status`, `runtime_surface`, `notes`)
VALUES
  ('wordpress_publish_routes', 'WordPress publish routes', 'wordpress', 'publish', 'D', 1, 'wordpress_post_publish_authority', 1, 1, 1, 0, 'baseline_registered', 'wordpress/phaseA.js', 'Publish is blocked unless resource authority evidence is satisfied by the route family.'),
  ('wordpress_draft_routes', 'WordPress draft routes', 'wordpress', 'draft_write', 'C', 1, 'wordpress_draft_write_authority', 1, 1, 1, 0, 'baseline_registered', 'wordpress/phaseA.js', 'Draft writes still require explicit site/resource authority.'),
  ('cloudflare_dns_routes', 'Cloudflare DNS routes', 'cloudflare', 'dns_write', 'D', 1, 'cloudflare_dns_write_authority', 1, 1, 1, 0, 'baseline_registered', 'adminCliRoutes.js', 'Cloudflare writes must not be inferred from admin intent.'),
  ('github_repo_mutation_routes', 'GitHub repository mutation routes', 'github', 'repo_mutation', 'D', 1, 'github_repo_patch_authority', 1, 1, 1, 0, 'baseline_registered', 'repo_patch_apply/admin_control', 'Repo mutations require governed preflight and resource authority evidence.'),
  ('local_connector_config_routes', 'Local connector configuration routes', 'local_connector', 'config_write', 'D', 1, 'local_connector_config_write_authority', 1, 1, 1, 0, 'baseline_registered', 'localConnectorRoutes.js', 'Local connector configuration writes require device/resource authority.'),
  ('gpt_session_write_routes', 'GPT session writeback routes', 'session_archive', 'session_write', 'C', 0, NULL, 1, 1, 1, 0, 'baseline_registered', 'gptSessionRoutes.js', 'Session writeback is scoped to active session authority and audit/readback evidence.'),
  ('tenant_docs_read_routes', 'Tenant-safe docs reader routes', 'tenant_docs', 'read', 'A', 0, NULL, 0, 0, 0, 1, 'read_only_certified', 'tenantDocsRoutes.js', 'Allowlisted tenant docs reader is read-only and membership gated.'),
  ('release_dashboard_routes', 'Release dashboard routes', 'release', 'read', 'A', 0, NULL, 0, 0, 0, 1, 'read_only_certified', 'releaseRoutes.js', 'Dashboard is a compact projection over release_readiness only.'),
  ('runtime_audit_routes', 'Runtime surface audit routes', 'runtime_audit', 'diagnostic', 'B', 0, NULL, 0, 0, 0, 1, 'diagnostic_certified', 'runtime-surface-coverage-audit.mjs', 'Fast code-only audit avoids long DB execution windows.');

INSERT IGNORE INTO `runtime_dispatch_certification_registry`
  (`certification_key`, `surface_key`, `surface_family`, `tool_or_action_key`, `risk_class`, `certification_status`, `smoke_strategy`, `dispatch_allowed`, `apply_allowed`, `requires_resource_authority`, `requires_dry_run`, `requires_audit_evidence`, `requires_readback`, `notes`)
VALUES
  ('tenant_docs_reader_v1', 'tenant_docs_read_routes', 'tenant_docs', 'tenant_repo_doc_read', 'A', 'read_only_certified', 'allowlisted_read_with_tenant_membership', 1, 0, 0, 0, 0, 0, 'Tenant docs reader exposes only allowlisted tenant-safe docs.'),
  ('release_dashboard_v1', 'release_dashboard_routes', 'release', 'release_dashboard', 'A', 'read_only_certified', 'release_readiness_projection', 1, 0, 0, 0, 0, 0, 'Compact dashboard reads release_readiness and is not a separate source of truth.'),
  ('runtime_surface_audit_fast_v1', 'runtime_audit_routes', 'runtime_audit', 'runtime_surface_coverage_audit_fast', 'B', 'diagnostic_certified', 'code_only_no_db_samples', 1, 0, 0, 0, 0, 0, 'Fast audit uses --code-only --no-samples to avoid HTTP timeout windows.'),
  ('admin_cloudflare_v1', 'cloudflare_dns_routes', 'admin', 'admin_cloudflare', 'D', 'baseline_registered', 'metadata_only_until_dry_run_exists', 0, 0, 1, 1, 1, 1, 'High-risk Cloudflare mutations require explicit authority and a safe dry-run path before certification.'),
  ('admin_connector_activate_v1', 'local_connector_config_routes', 'admin', 'admin_connector_activate', 'D', 'baseline_registered', 'metadata_only_until_dry_run_exists', 0, 0, 1, 1, 1, 1, 'Connector activation is mutation-capable and must remain authority-gated.'),
  ('local_connector_self_repair_v1', 'local_connector_config_routes', 'local_connector', 'local_connector_self_repair', 'D', 'baseline_registered', 'metadata_only_until_dry_run_exists', 0, 0, 1, 1, 1, 1, 'Self-repair may generate installer assets and requires explicit device authority.'),
  ('gpt_session_turn_write_v1', 'gpt_session_write_routes', 'session_archive', 'gpt_session_turn_write', 'C', 'baseline_registered', 'synthetic_session_smoke_required', 0, 0, 0, 1, 1, 1, 'Writeback requires session scope and bounded archive readback.'),
  ('gpt_session_end_v1', 'gpt_session_write_routes', 'session_archive', 'gpt_session_end', 'C', 'baseline_registered', 'synthetic_session_smoke_required', 0, 0, 0, 1, 1, 1, 'Session close/export requires active session authority and readback.'),
  ('release_session_archive_smoke_v1', 'gpt_session_write_routes', 'release', 'release_session_archive_smoke', 'C', 'baseline_registered', 'cleanup_default_smoke', 0, 0, 0, 1, 1, 1, 'Synthetic smoke is write-capable and should remain explicit, bounded, and cleanup-default.'),
  ('wordpress_publish_v1', 'wordpress_publish_routes', 'wordpress', 'wordpress_blog_publish_orchestrator', 'D', 'baseline_registered', 'cms_site_grant_preflight_required', 0, 0, 1, 1, 1, 1, 'Publish requires CMS site access grants and resource authority evidence.');
