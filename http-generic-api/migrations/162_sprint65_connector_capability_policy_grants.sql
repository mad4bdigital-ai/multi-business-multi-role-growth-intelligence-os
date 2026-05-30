-- Sprint 65: DB-backed local connector capability grants
-- Keeps local connector capabilities durable across repair installer runs.

CREATE TABLE IF NOT EXISTS `local_connector_capability_grants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_id` VARCHAR(36) NOT NULL,
  `capability_key` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `risk_class` VARCHAR(64) NOT NULL DEFAULT 'privileged_local_runtime',
  `source` VARCHAR(64) NOT NULL DEFAULT 'db',
  `description` VARCHAR(512) NULL,
  `policy_version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lc_capability_grant_config_key` (`config_id`, `capability_key`),
  KEY `idx_lc_capability_grant_config_status` (`config_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `local_connector_app_allowlists` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_id` VARCHAR(36) NOT NULL,
  `app_alias` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `command_path` VARCHAR(512) NOT NULL,
  `process_name` VARCHAR(128) NULL,
  `browser` TINYINT(1) NOT NULL DEFAULT 0,
  `capability_class` VARCHAR(80) NOT NULL DEFAULT 'desktop_app',
  `risk_class` VARCHAR(80) NOT NULL DEFAULT 'interactive',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `source` VARCHAR(64) NOT NULL DEFAULT 'db',
  `description` VARCHAR(512) NULL,
  `policy_version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lc_app_allowlist_config_alias` (`config_id`, `app_alias`),
  KEY `idx_lc_app_allowlist_config_status` (`config_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `local_connector_capability_grants`
  (`config_id`, `capability_key`, `status`, `risk_class`, `source`, `description`, `policy_version`)
VALUES
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'powershell_admin', 'active', 'privileged_local_runtime', 'db_seed', 'Admin-approved PowerShell endpoint for Essam local connector smoke and governed recovery.', 1),
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'windows_control', 'active', 'privileged_local_runtime', 'db_seed', 'Admin-approved Windows process/control endpoint for Essam local connector diagnostics.', 1),
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'dependencies', 'active', 'privileged_local_runtime', 'db_seed', 'Admin-approved dependency status/install surface for allowlisted packages only.', 1),
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'auto_browser', 'active', 'privileged_local_runtime', 'db_seed', 'Enable Auto Browser status probe after local runtime installation; non-status actions stay blocked until PoC validation.', 1)
ON DUPLICATE KEY UPDATE
  `status` = VALUES(`status`),
  `risk_class` = VALUES(`risk_class`),
  `source` = VALUES(`source`),
  `description` = VALUES(`description`),
  `policy_version` = GREATEST(`policy_version`, VALUES(`policy_version`));

INSERT INTO `local_connector_file_access_rules`
  (`config_id`, `path_pattern`, `access_mode`, `description`)
SELECT '8db63b00-4fce-11f1-b256-614c56cd019b', 'D:\\n8n-data', 'read_write', 'Admin-approved n8n data root for local connector runtime operations'
WHERE NOT EXISTS (
  SELECT 1 FROM `local_connector_file_access_rules`
   WHERE `config_id` = '8db63b00-4fce-11f1-b256-614c56cd019b'
     AND `path_pattern` = 'D:\\n8n-data'
);

INSERT INTO `local_connector_file_access_rules`
  (`config_id`, `path_pattern`, `access_mode`, `description`)
SELECT '8db63b00-4fce-11f1-b256-614c56cd019b', 'D:\\n8n-data\\browser-runtime-artifacts', 'read_write', 'Browser runtime artifacts directory for Browser4 and governed browser diagnostics'
WHERE NOT EXISTS (
  SELECT 1 FROM `local_connector_file_access_rules`
   WHERE `config_id` = '8db63b00-4fce-11f1-b256-614c56cd019b'
     AND `path_pattern` = 'D:\\n8n-data\\browser-runtime-artifacts'
);

INSERT INTO `local_connector_file_access_rules`
  (`config_id`, `path_pattern`, `access_mode`, `description`)
SELECT '8db63b00-4fce-11f1-b256-614c56cd019b', 'D:\\n8n-data\\auto-browser', 'read_write', 'Auto Browser local runtime working directory'
WHERE NOT EXISTS (
  SELECT 1 FROM `local_connector_file_access_rules`
   WHERE `config_id` = '8db63b00-4fce-11f1-b256-614c56cd019b'
     AND `path_pattern` = 'D:\\n8n-data\\auto-browser'
);

INSERT INTO `local_connector_app_allowlists`
  (`config_id`, `app_alias`, `display_name`, `command_path`, `process_name`, `browser`, `capability_class`, `risk_class`, `status`, `source`, `description`, `policy_version`)
VALUES
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'edge', 'Microsoft Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'msedge', 1, 'browser', 'interactive', 'active', 'db_seed', 'Admin-approved local browser for user-visible diagnostics.', 1),
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'chrome', 'Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'chrome', 1, 'browser', 'interactive', 'active', 'db_seed', 'Admin-approved local browser for user-visible diagnostics.', 1)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `command_path` = VALUES(`command_path`),
  `process_name` = VALUES(`process_name`),
  `browser` = VALUES(`browser`),
  `capability_class` = VALUES(`capability_class`),
  `risk_class` = VALUES(`risk_class`),
  `status` = VALUES(`status`),
  `source` = VALUES(`source`),
  `description` = VALUES(`description`),
  `policy_version` = GREATEST(`policy_version`, VALUES(`policy_version`));
