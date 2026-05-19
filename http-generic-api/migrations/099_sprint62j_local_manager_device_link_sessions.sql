-- Sprint 62j: Local Manager device-code linking sessions
-- Public Windows app starts a short-lived pairing session; a signed-in user approves it;
-- the app polls with its private poll token to receive a scoped device access token.

CREATE TABLE IF NOT EXISTS `local_manager_device_link_sessions` (
  `session_id` VARCHAR(64) NOT NULL,
  `display_code` VARCHAR(16) NOT NULL,
  `display_code_hash` VARCHAR(64) NOT NULL,
  `poll_token_hash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `device_id` VARCHAR(128) NOT NULL,
  `hostname` VARCHAR(255) NULL,
  `platform` VARCHAR(32) NULL,
  `app_version` VARCHAR(80) NULL,
  `user_id` VARCHAR(64) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `approved_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `expires_at` DATETIME NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uq_local_manager_display_code_hash` (`display_code_hash`),
  KEY `idx_local_manager_device_link_status` (`status`, `expires_at`),
  KEY `idx_local_manager_device_link_owner` (`user_id`, `tenant_id`),
  KEY `idx_local_manager_device_link_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
