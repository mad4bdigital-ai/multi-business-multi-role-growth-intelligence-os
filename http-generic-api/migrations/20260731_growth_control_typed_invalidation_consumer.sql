-- Spec 011 T603: typed Growth Control lifecycle invalidation consumer.
-- Additive only. Consumer starts in shadow mode and performs no provider call,
-- credential read, external send, deployment, or production activation.

CREATE TABLE IF NOT EXISTS `growth_control_invalidation_revisions` (
  `invalidation_key` VARCHAR(255) NOT NULL,
  `invalidation_type` ENUM(
    'configuration_definition',
    'effective_scope_resolution',
    'configuration_version',
    'compiled_plan_dependencies',
    'tenant_projection',
    'workspace_projection'
  ) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `workspace_id` VARCHAR(64) NULL,
  `config_key` VARCHAR(128) NOT NULL,
  `scope_hash` CHAR(64) NOT NULL,
  `source_version_id` VARCHAR(64) NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `last_event_id` CHAR(36) NOT NULL,
  `last_event_type` VARCHAR(160) NOT NULL,
  `last_payload_sha256` CHAR(64) NOT NULL,
  `last_plan_sha256` CHAR(64) NOT NULL,
  `invalidated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`invalidation_key`),
  KEY `idx_growth_invalidation_scope` (`tenant_id`,`workspace_id`,`config_key`,`invalidation_type`),
  KEY `idx_growth_invalidation_event` (`last_event_id`,`last_event_type`),
  KEY `idx_growth_invalidation_freshness` (`invalidated_at`,`revision`),
  CONSTRAINT `chk_growth_invalidation_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_outbox_consumers` (
  `consumer_key`,
  `display_name`,
  `target_environment`,
  `transport_key`,
  `endpoint_url`,
  `auth_scheme`,
  `credential_ref`,
  `mask_policy_key`,
  `status`,
  `batch_size`,
  `timeout_ms`,
  `max_attempts`,
  `retry_base_seconds`
) VALUES (
  'growth_control_invalidation_v1',
  'Growth Control typed invalidation consumer v1',
  'shadow',
  'noop',
  NULL,
  'none',
  NULL,
  'default_shadow_mask_v1',
  'shadow',
  50,
  10000,
  8,
  30
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `target_environment` = VALUES(`target_environment`),
  `transport_key` = VALUES(`transport_key`),
  `endpoint_url` = NULL,
  `auth_scheme` = 'none',
  `credential_ref` = NULL,
  `mask_policy_key` = VALUES(`mask_policy_key`),
  `batch_size` = VALUES(`batch_size`),
  `timeout_ms` = VALUES(`timeout_ms`),
  `max_attempts` = VALUES(`max_attempts`),
  `retry_base_seconds` = VALUES(`retry_base_seconds`),
  `updated_at` = CURRENT_TIMESTAMP(6);

INSERT INTO `governed_migration_authorization_registry` (
  `migration_file`,
  `authorization_status`,
  `authorization_source`,
  `policy_key`,
  `risk_tier`,
  `requires_preflight`,
  `requires_confirmation`,
  `allow_record_only`,
  `allow_apply`,
  `notes`,
  `metadata_json`
) VALUES (
  '20260731_growth_control_typed_invalidation_consumer.sql',
  'authorized',
  'spec_011_t603_implementation',
  'governed_migration_runner_authorization_v1',
  'high',
  1,
  1,
  1,
  1,
  'Additive typed invalidation revision authority and shadow consumer registration. No external effects.',
  JSON_OBJECT(
    'spec_key','011-dynamic-multi-tenant-growth-control-plane',
    'task_key','T603',
    'additive_only',TRUE,
    'consumer_default_status','shadow',
    'provider_writes',FALSE,
    'external_sends',FALSE,
    'credentials_read',FALSE,
    'secrets_included',FALSE
  )
)
ON DUPLICATE KEY UPDATE
  `authorization_status` = VALUES(`authorization_status`),
  `authorization_source` = VALUES(`authorization_source`),
  `policy_key` = VALUES(`policy_key`),
  `risk_tier` = VALUES(`risk_tier`),
  `requires_preflight` = VALUES(`requires_preflight`),
  `requires_confirmation` = VALUES(`requires_confirmation`),
  `allow_record_only` = VALUES(`allow_record_only`),
  `allow_apply` = VALUES(`allow_apply`),
  `notes` = VALUES(`notes`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
