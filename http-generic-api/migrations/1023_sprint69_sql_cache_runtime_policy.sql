CREATE TABLE IF NOT EXISTS `sql_cache_runtime_policies` (
  `policy_key` VARCHAR(191) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `config_json` JSON NOT NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`),
  KEY `idx_sql_cache_runtime_policies_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `sql_cache_runtime_policies`
  (`policy_key`, `revision`, `enabled`, `config_json`, `updated_by`)
VALUES
  (
    'sql_cache_policy_v2',
    1,
    1,
    JSON_OBJECT(
      'required', FALSE,
      'key_version', 'v2',
      'max_value_bytes', 1048576,
      'oversize_cooldown_seconds', 300,
      'circuit_breaker_seconds', 15,
      'single_flight_enabled', TRUE,
      'table_allowlist', '',
      'table_blocklist', 'endpoints',
      'table_policies', JSON_OBJECT()
    ),
    '1023_sprint69_sql_cache_runtime_policy'
  )
ON DUPLICATE KEY UPDATE
  `policy_key` = VALUES(`policy_key`);
