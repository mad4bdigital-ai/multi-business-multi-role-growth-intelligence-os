-- Repository-owned schema for Local Manager desktop command polling.
-- Runtime requests must never create or alter this table.
CREATE TABLE IF NOT EXISTS `local_manager_desktop_commands` (
  `command_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `device_id` VARCHAR(128) NOT NULL,
  `execution_mode` ENUM('desktop','background') NOT NULL DEFAULT 'desktop',
  `action` VARCHAR(64) NOT NULL,
  `status` ENUM('queued','claimed','completed','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
  `priority` INT NOT NULL DEFAULT 100,
  `requires_user_confirmation` TINYINT(1) NOT NULL DEFAULT 0,
  `payload_json` JSON NULL,
  `result_json` JSON NULL,
  `requested_by` VARCHAR(128) NULL,
  `request_context_json` JSON NULL,
  `error_code` VARCHAR(96) NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `claimed_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`command_id`),
  KEY `idx_lm_desktop_command_device` (`tenant_id`, `user_id`, `device_id`, `status`, `priority`, `created_at`),
  KEY `idx_lm_desktop_command_status` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
