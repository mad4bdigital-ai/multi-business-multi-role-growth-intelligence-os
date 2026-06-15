-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: Dynamic Audit runtime closure.
-- Additive and idempotent. No provider calls. No raw payload storage.
-- No credentials. No external sends. No external writes. secrets_included=false

CREATE TABLE IF NOT EXISTS `dynamic_audit_scheduler_runs` (
  `run_id` VARCHAR(64) NOT NULL,
  `mode` VARCHAR(64) NOT NULL,
  `run_status` ENUM('running','succeeded','failed','skipped') NOT NULL DEFAULT 'running',
  `stage_summary_json` JSON NULL,
  `error_code` VARCHAR(128) NULL,
  `error_message` VARCHAR(1000) NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`run_id`),
  KEY `idx_dynamic_audit_scheduler_status` (`run_status`,`started_at`),
  KEY `idx_dynamic_audit_scheduler_completed` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_runtime_config`
  (`config_key`,`config_json`,`status`,`note`,`created_at`,`updated_at`)
VALUES
(
  'dynamic_audit_scheduler',
  JSON_OBJECT(
    'enabled', TRUE,
    'mode', 'internal_runtime_interval_with_mysql_advisory_lock',
    'cadence_minutes', 5,
    'batch_limit', 1000,
    'source_limit', 500,
    'checkpoint_batch_limit', 1000,
    'checkpoint_min_events', 100,
    'checkpoint_max_age_minutes', 30,
    'run_on_startup', TRUE,
    'executor_module', 'http-generic-api/dynamicAuditRuntime.js',
    'cycle_alias', 'governed_platform_automation_tick',
    'lease', 'mysql_advisory_lock',
    'raw_payload_stored', FALSE,
    'raw_before_after_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Canonical internal Dynamic Audit scheduler configuration.',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
),
(
  'dynamic_audit_checkpoint_scope',
  JSON_OBJECT(
    'scope_key', 'brand:growth_intelligence_platform|tenant:00000000-0000-4000-a000-000000000010',
    'tenant_id', '00000000-0000-4000-a000-000000000010',
    'user_id', 'f242960c-2857-4b4d-a504-ee50f8a278b4',
    'brand_key', 'growth_intelligence_platform',
    'deployed_commit_sha_policy', 'never_infer',
    'secrets_included', FALSE
  ),
  'active',
  'Canonical scope for Dynamic Audit checkpoint rollups.',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
),
(
  'audit_log_event_bus_bridge_schedule',
  JSON_OBJECT(
    'enabled', TRUE,
    'mode', 'internal_runtime_scheduler',
    'alias', 'audit_log_event_bus_bridge_tick',
    'cadence_minutes', 5,
    'batch_limit', 1000,
    'source_table', 'audit_log',
    'target_table', 'platform_audit_event_bus',
    'executor_module', 'http-generic-api/dynamicAuditRuntime.js',
    'idempotent_key_prefix', 'audit_log:',
    'raw_payload_stored', FALSE,
    'raw_before_after_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Canonical Dynamic Audit bridge schedule.',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
),
(
  'audit_event_rollup_builder_schedule',
  JSON_OBJECT(
    'enabled', TRUE,
    'mode', 'internal_runtime_scheduler',
    'alias', 'audit_event_rollup_builder_tick',
    'cadence_minutes', 5,
    'batch_limit', 1000,
    'source_table', 'platform_audit_event_bus',
    'target_tables', JSON_ARRAY(
      'db_change_audit_events',
      'asset_audit_events',
      'checkpoint_auto_rollups'
    ),
    'executor_module', 'http-generic-api/dynamicAuditRuntime.js',
    'raw_payload_stored', FALSE,
    'raw_before_after_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Canonical Dynamic Audit rollup schedule.',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `config_json` = VALUES(`config_json`),
  `status` = VALUES(`status`),
  `note` = VALUES(`note`),
  `updated_at` = UTC_TIMESTAMP();

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_counts` AS
SELECT
  (SELECT COUNT(*) FROM `audit_log`) AS `audit_log_total`,
  (SELECT COUNT(*) FROM `platform_audit_event_bus`
    WHERE `source_family`='audit_log') AS `event_bus_audit_log_total`,
  (SELECT COUNT(*)
     FROM `audit_log` l
    WHERE NOT EXISTS (
      SELECT 1
        FROM `platform_audit_event_bus` e
       WHERE e.`event_key` COLLATE utf8mb4_unicode_ci =
             CONCAT('audit_log:',l.`audit_id`) COLLATE utf8mb4_unicode_ci
    )) AS `audit_log_to_event_bus_gap`,
  (SELECT COUNT(*)
     FROM `platform_audit_event_bus` e
    WHERE e.`event_status` IN ('observed','pending_rollup')
      AND NOT EXISTS (
        SELECT 1 FROM `db_change_audit_events` d
         WHERE d.`source_event_key` COLLATE utf8mb4_unicode_ci =
               e.`event_key` COLLATE utf8mb4_unicode_ci
      )
      AND NOT EXISTS (
        SELECT 1 FROM `asset_audit_events` a
         WHERE a.`source_event_key` COLLATE utf8mb4_unicode_ci =
               e.`event_key` COLLATE utf8mb4_unicode_ci
      )
      AND NOT EXISTS (
        SELECT 1 FROM `checkpoint_auto_rollups` c
         WHERE c.`source_event_key` COLLATE utf8mb4_unicode_ci =
               e.`event_key` COLLATE utf8mb4_unicode_ci
      )) AS `event_bus_unrolled_total`,
  (SELECT COUNT(*)
     FROM `platform_audit_event_bus`
    WHERE `event_status` IN ('observed','pending_rollup')
      AND `created_at` < UTC_TIMESTAMP() - INTERVAL 15 MINUTE) AS `event_bus_stale_pending_total`,
  (SELECT COUNT(*) FROM `db_change_audit_events`) AS `db_change_rollup_total`,
  (SELECT COUNT(*) FROM `db_change_audit_events`
    WHERE `mutation_class`='unknown'
       OR `table_name` IN ('db','unresolved_admin_control_db')) AS `db_change_semantics_unknown_total`,
  (SELECT COUNT(*) FROM `asset_audit_events`) AS `asset_rollup_total`,
  (SELECT COUNT(*) FROM `asset_audit_events`
    WHERE `provider_key`='google_drive') AS `drive_asset_event_total`,
  (SELECT COUNT(*) FROM `asset_audit_events`
    WHERE `provider_key`='google_drive'
      AND `change_status`='readback_verified') AS `drive_asset_readback_verified_total`,
  (SELECT COUNT(*) FROM `repo_file_audit_runs`) AS `repo_file_audit_run_total`,
  (SELECT COUNT(*) FROM `repo_file_audit_findings`) AS `repo_file_audit_finding_total`,
  (SELECT MAX(`completed_at`) FROM `repo_file_audit_runs`
    WHERE `run_status`='completed') AS `repo_file_audit_last_completed_at`,
  (SELECT COUNT(*) FROM `checkpoint_auto_rollups`
    WHERE `rollup_status`='planned') AS `checkpoint_rollup_planned_total`,
  (SELECT COUNT(*) FROM `checkpoint_auto_rollups`
    WHERE `rollup_status`='written') AS `checkpoint_rollup_written_total`,
  (SELECT MIN(`created_at`) FROM `checkpoint_auto_rollups`
    WHERE `rollup_status`='planned') AS `checkpoint_oldest_planned_at`,
  (SELECT MAX(`completed_at`) FROM `dynamic_audit_scheduler_runs`
    WHERE `run_status`='succeeded') AS `scheduler_last_success_at`,
  (SELECT MAX(`started_at`) FROM `dynamic_audit_scheduler_runs`) AS `scheduler_last_attempt_at`,
  0 AS `raw_payload_stored`,
  0 AS `raw_before_after_stored`,
  0 AS `secrets_included`;

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_quality` AS
SELECT
  'event_bus' AS `surface`,
  COUNT(*) AS `checked_rows`,
  SUM(CASE
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_payload_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_before_after_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.secrets_included')),'false') <> 'false'
    THEN 1 ELSE 0 END) AS `bad_evidence_rows`,
  (SELECT COUNT(*) FROM (
    SELECT `event_key`
      FROM `platform_audit_event_bus`
     GROUP BY `event_key`
    HAVING COUNT(*) > 1
  ) duplicated) AS `duplicate_key_rows`
FROM `platform_audit_event_bus`
UNION ALL
SELECT
  'db_change_rollup',
  COUNT(*),
  SUM(CASE
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_payload_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_before_after_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.secrets_included')),'false') <> 'false'
    THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (
    SELECT `source_event_key`
      FROM `db_change_audit_events`
     WHERE `source_event_key` IS NOT NULL
     GROUP BY `source_event_key`
    HAVING COUNT(*) > 1
  ) duplicated)
FROM `db_change_audit_events`
UNION ALL
SELECT
  'asset_rollup',
  COUNT(*),
  SUM(CASE
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_payload_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_before_after_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.secrets_included')),'false') <> 'false'
    THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (
    SELECT `source_event_key`
      FROM `asset_audit_events`
     WHERE `source_event_key` IS NOT NULL
     GROUP BY `source_event_key`
    HAVING COUNT(*) > 1
  ) duplicated)
FROM `asset_audit_events`
UNION ALL
SELECT
  'checkpoint_rollup',
  COUNT(*),
  SUM(CASE
    WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_payload_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.raw_before_after_stored')),'false') <> 'false'
      OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`evidence_json`,'$.secrets_included')),'false') <> 'false'
    THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (
    SELECT `source_event_key`
      FROM `checkpoint_auto_rollups`
     WHERE `source_event_key` IS NOT NULL
     GROUP BY `source_event_key`
    HAVING COUNT(*) > 1
  ) duplicated)
FROM `checkpoint_auto_rollups`;

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_readiness` AS
SELECT
  'dynamic_audit_pipeline' AS `readiness_key`,
  CASE
    WHEN (
      SELECT COALESCE(SUM(`bad_evidence_rows`),0) +
             COALESCE(SUM(`duplicate_key_rows`),0)
        FROM `v_dynamic_audit_pipeline_quality`
    ) > 0 THEN 'fail'
    WHEN c.`scheduler_last_success_at` IS NULL
      OR c.`scheduler_last_success_at` < UTC_TIMESTAMP() - INTERVAL 15 MINUTE
      OR c.`audit_log_to_event_bus_gap` > 1000
      OR c.`event_bus_unrolled_total` > 5000
      OR c.`repo_file_audit_run_total` = 0
      OR c.`drive_asset_event_total` = 0
      OR (
        c.`checkpoint_rollup_planned_total` > 0
        AND c.`checkpoint_oldest_planned_at` < UTC_TIMESTAMP() - INTERVAL 30 MINUTE
      )
      OR (
        c.`db_change_rollup_total` > 0
        AND c.`db_change_semantics_unknown_total` * 2 > c.`db_change_rollup_total`
      )
    THEN 'warn'
    ELSE 'pass'
  END AS `readiness_status`,
  c.*,
  (SELECT COALESCE(SUM(`bad_evidence_rows`),0)
     FROM `v_dynamic_audit_pipeline_quality`) AS `bad_evidence_rows`,
  (SELECT COALESCE(SUM(`duplicate_key_rows`),0)
     FROM `v_dynamic_audit_pipeline_quality`) AS `duplicate_key_rows`,
  CASE
    WHEN (SELECT COALESCE(SUM(`bad_evidence_rows`),0)
            FROM `v_dynamic_audit_pipeline_quality`) > 0
      THEN 'bad_evidence_flags'
    WHEN (SELECT COALESCE(SUM(`duplicate_key_rows`),0)
            FROM `v_dynamic_audit_pipeline_quality`) > 0
      THEN 'duplicate_keys'
    WHEN c.`scheduler_last_success_at` IS NULL
      OR c.`scheduler_last_success_at` < UTC_TIMESTAMP() - INTERVAL 15 MINUTE
      THEN 'scheduler_stale_or_missing'
    WHEN c.`audit_log_to_event_bus_gap` > 1000
      THEN 'audit_log_to_event_bus_gap_high'
    WHEN c.`event_bus_unrolled_total` > 5000
      THEN 'event_bus_rollup_lag_high'
    WHEN c.`repo_file_audit_run_total` = 0
      THEN 'repo_file_audit_missing'
    WHEN c.`drive_asset_event_total` = 0
      THEN 'google_drive_audit_missing'
    WHEN c.`checkpoint_rollup_planned_total` > 0
      AND c.`checkpoint_oldest_planned_at` < UTC_TIMESTAMP() - INTERVAL 30 MINUTE
      THEN 'checkpoint_rollup_writer_lag'
    WHEN c.`db_change_rollup_total` > 0
      AND c.`db_change_semantics_unknown_total` * 2 > c.`db_change_rollup_total`
      THEN 'db_change_semantics_incomplete'
    ELSE 'ready'
  END AS `readiness_reason`,
  'governed_platform_automation_tick' AS `recommended_tick_alias`
FROM `v_dynamic_audit_pipeline_counts` c;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,
   `risk_tier`,`requires_preflight`,`requires_confirmation`,
   `allow_record_only`,`allow_apply`,`notes`,`metadata_json`,`created_at`,`updated_at`)
VALUES
(
  '314_sprint69_dynamic_audit_runtime_closure.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  1,
  1,
  'Authorized additive Dynamic Audit runtime closure migration.',
  JSON_OBJECT(
    'additive_only', TRUE,
    'creates_internal_scheduler', TRUE,
    'creates_database_trigger', FALSE,
    'provider_calls', FALSE,
    'raw_payload_storage', FALSE,
    'secrets_included', FALSE
  ),
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `authorization_status`='authorized',
  `risk_tier`='medium',
  `requires_preflight`=1,
  `requires_confirmation`=1,
  `allow_record_only`=1,
  `allow_apply`=1,
  `notes`=VALUES(`notes`),
  `metadata_json`=VALUES(`metadata_json`),
  `updated_at`=UTC_TIMESTAMP();
