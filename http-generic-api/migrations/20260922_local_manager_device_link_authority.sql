-- Governed Local Manager device-link authority hardening.
-- Removes request-time schema mutation and adds atomic token issuance + revocation state.

ALTER TABLE `local_manager_device_link_sessions`
  MODIFY COLUMN `display_code` VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS `device_token_jti` VARCHAR(64) NULL AFTER `completed_at`,
  ADD COLUMN IF NOT EXISTS `device_token_issued_at` DATETIME NULL AFTER `device_token_jti`,
  ADD COLUMN IF NOT EXISTS `revoked_at` DATETIME NULL AFTER `device_token_issued_at`,
  ADD COLUMN IF NOT EXISTS `revoked_by_user_id` VARCHAR(64) NULL AFTER `revoked_at`,
  ADD KEY IF NOT EXISTS `idx_local_manager_device_link_token_jti` (`device_token_jti`),
  ADD KEY IF NOT EXISTS `idx_local_manager_device_link_revocation` (`status`, `revoked_at`);

UPDATE `local_manager_device_link_sessions`
   SET `display_code` = NULL
 WHERE `display_code` IS NOT NULL
   AND `display_code_hash` IS NOT NULL;
