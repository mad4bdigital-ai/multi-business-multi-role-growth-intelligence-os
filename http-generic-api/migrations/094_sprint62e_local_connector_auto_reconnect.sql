-- Sprint 62e: local connector auto-reconnect and safe upgrade metadata
-- The local connector must survive bad server.mjs upgrades, service restarts,
-- and cloudflared service failures without requiring GPT access to the device.

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN IF NOT EXISTS `auto_reconnect_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_enabled`,
  ADD COLUMN IF NOT EXISTS `watchdog_installed` TINYINT(1) NOT NULL DEFAULT 0 AFTER `auto_reconnect_enabled`,
  ADD COLUMN IF NOT EXISTS `watchdog_version` VARCHAR(64) NULL AFTER `watchdog_installed`,
  ADD COLUMN IF NOT EXISTS `agent_version` VARCHAR(64) NULL AFTER `watchdog_version`,
  ADD COLUMN IF NOT EXISTS `desired_agent_version` VARCHAR(64) NULL AFTER `agent_version`,
  ADD COLUMN IF NOT EXISTS `active_slot` ENUM('a','b','legacy') NOT NULL DEFAULT 'legacy' AFTER `desired_agent_version`,
  ADD COLUMN IF NOT EXISTS `last_health_at` DATETIME NULL AFTER `active_slot`,
  ADD COLUMN IF NOT EXISTS `last_reconnect_at` DATETIME NULL AFTER `last_health_at`,
  ADD COLUMN IF NOT EXISTS `last_repair_at` DATETIME NULL AFTER `last_reconnect_at`,
  ADD COLUMN IF NOT EXISTS `last_repair_status` ENUM('ok','failed','rollback','manual_required') NULL AFTER `last_repair_at`,
  ADD COLUMN IF NOT EXISTS `last_error_code` VARCHAR(128) NULL AFTER `last_repair_status`,
  ADD COLUMN IF NOT EXISTS `last_error_message` TEXT NULL AFTER `last_error_code`,
  ADD COLUMN IF NOT EXISTS `recovery_notes` TEXT NULL AFTER `last_error_message`;

CREATE TABLE IF NOT EXISTS `local_connector_recovery_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(36) NOT NULL,
  `config_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NULL,
  `event_type` ENUM('health_ok','health_failed','service_restart','cloudflared_restart','safe_upgrade','rollback','repair_bundle','manual_recovery','watchdog_install') NOT NULL,
  `status` ENUM('started','ok','failed','skipped') NOT NULL DEFAULT 'started',
  `source` ENUM('watchdog','auth_repair','installer','admin','manual') NOT NULL DEFAULT 'watchdog',
  `agent_version` VARCHAR(64) NULL,
  `active_slot` VARCHAR(16) NULL,
  `error_code` VARCHAR(128) NULL,
  `error_message` TEXT NULL,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_local_connector_recovery_event_id` (`event_id`),
  KEY `idx_local_connector_recovery_config` (`config_id`, `created_at`),
  KEY `idx_local_connector_recovery_device` (`device_id`, `created_at`),
  KEY `idx_local_connector_recovery_type` (`event_type`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE `local_connector_user_configs`
   SET auto_reconnect_enabled = 1
 WHERE auto_reconnect_enabled IS NULL OR auto_reconnect_enabled = 0;
