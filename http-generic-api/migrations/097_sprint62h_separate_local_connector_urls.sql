-- Sprint 62h: separate local connector URL roles
-- local.mad4b.com is a GPT schema/public gateway alias to Auth runtime.
-- connector.mad4b.com is admin/break-glass only.
-- device_runtime_url is the server-to-device runtime target used by Auth proxy.

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN IF NOT EXISTS `public_gateway_url` VARCHAR(255) NULL AFTER `tunnel_url`,
  ADD COLUMN IF NOT EXISTS `device_runtime_url` VARCHAR(255) NULL AFTER `public_gateway_url`,
  ADD COLUMN IF NOT EXISTS `admin_recovery_url` VARCHAR(255) NULL AFTER `device_runtime_url`;

UPDATE `local_connector_user_configs`
   SET public_gateway_url = COALESCE(public_gateway_url, 'https://local.mad4b.com'),
       admin_recovery_url = COALESCE(admin_recovery_url, 'https://connector.mad4b.com')
 WHERE is_enabled = 1;

-- Temporary compatibility for the current canonical Essam device. Replace with a
-- dedicated tenant-safe runtime hostname before broader tenant promotion.
UPDATE `local_connector_user_configs`
   SET device_runtime_url = COALESCE(device_runtime_url, tunnel_url)
 WHERE is_enabled = 1
   AND device_runtime_url IS NULL;
