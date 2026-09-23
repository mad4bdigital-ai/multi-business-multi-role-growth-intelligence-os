-- Governed Local Manager device-link authority hardening.
-- Removes request-time schema mutation and adds atomic token issuance + revocation state.

CREATE TABLE IF NOT EXISTS `local_manager_device_link_sessions` (
  `session_id` VARCHAR(64) NOT NULL,
  `display_code` VARCHAR(16) NULL,
  `display_code_hash` CHAR(64) NOT NULL,
  `poll_token_hash` CHAR(64) NOT NULL,
  `status` ENUM('pending','approved','completed','expired','revoked') NOT NULL DEFAULT 'pending',
  `device_id` VARCHAR(128) NOT NULL,
  `hostname` VARCHAR(255) NULL,
  `platform` VARCHAR(32) NULL,
  `app_version` VARCHAR(80) NULL,
  `user_id` VARCHAR(64) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `approved_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `device_token_jti` VARCHAR(64) NULL,
  `device_token_issued_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `revoked_by_user_id` VARCHAR(64) NULL,
  `expires_at` DATETIME NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uq_local_manager_device_link_display_code_hash` (`display_code_hash`),
  UNIQUE KEY `uq_local_manager_device_link_poll_token_hash` (`poll_token_hash`),
  KEY `idx_local_manager_device_link_status_expiry` (`status`, `expires_at`),
  KEY `idx_local_manager_device_link_user_device` (`user_id`, `tenant_id`, `device_id`),
  KEY `idx_local_manager_device_link_token_jti` (`device_token_jti`),
  KEY `idx_local_manager_device_link_revocation` (`status`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `local_manager_device_link_sessions`
  MODIFY COLUMN `display_code` VARCHAR(16) NULL,
  MODIFY COLUMN `status` ENUM('pending','approved','completed','expired','revoked') NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS `device_token_jti` VARCHAR(64) NULL AFTER `completed_at`,
  ADD COLUMN IF NOT EXISTS `device_token_issued_at` DATETIME NULL AFTER `device_token_jti`,
  ADD COLUMN IF NOT EXISTS `revoked_at` DATETIME NULL AFTER `device_token_issued_at`,
  ADD COLUMN IF NOT EXISTS `revoked_by_user_id` VARCHAR(64) NULL AFTER `revoked_at`,
  ADD KEY IF NOT EXISTS `idx_local_manager_device_link_token_jti` (`device_token_jti`),
  ADD KEY IF NOT EXISTS `idx_local_manager_device_link_revocation` (`status`, `revoked_at`);

-- Existing device-link rows are operational state and are intentionally not rewritten
-- by a schema migration. Approved/completed runtime transitions clear display_code
-- under their bounded row authority; any historical cleanup requires a separately
-- governed operational-state reconciliation with explicit readback.
