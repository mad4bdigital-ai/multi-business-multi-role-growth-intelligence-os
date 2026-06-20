-- Sprint 69: explicit local connector device lifecycle state
-- Additive compatibility layer for device trust evaluation. Existing is_enabled
-- remains authoritative for legacy writers; runtime denies unless both controls
-- allow execution.

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN IF NOT EXISTS `lifecycle_state`
    ENUM('active','disabled','revoked','archived') NOT NULL DEFAULT 'active'
    AFTER `is_enabled`,
  ADD COLUMN IF NOT EXISTS `revoked_at` DATETIME NULL AFTER `lifecycle_state`,
  ADD COLUMN IF NOT EXISTS `revoked_by` VARCHAR(64) NULL AFTER `revoked_at`,
  ADD COLUMN IF NOT EXISTS `archived_at` DATETIME NULL AFTER `revoked_by`,
  ADD COLUMN IF NOT EXISTS `archived_by` VARCHAR(64) NULL AFTER `archived_at`,
  ADD COLUMN IF NOT EXISTS `lifecycle_reason` VARCHAR(512) NULL AFTER `archived_by`;

UPDATE `local_connector_user_configs`
   SET lifecycle_state = CASE
     WHEN is_enabled = 1 THEN 'active'
     ELSE 'disabled'
   END
 WHERE lifecycle_state IS NULL
    OR lifecycle_state = '';

CREATE INDEX IF NOT EXISTS `idx_local_connector_tenant_lifecycle`
  ON `local_connector_user_configs` (`tenant_id`, `lifecycle_state`, `updated_at`);

CREATE INDEX IF NOT EXISTS `idx_local_connector_user_device_lifecycle`
  ON `local_connector_user_configs` (`user_id`, `device_id`, `lifecycle_state`);
