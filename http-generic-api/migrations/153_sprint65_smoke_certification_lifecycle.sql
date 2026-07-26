-- Sprint 65: Platform Plugin smoke certification lifecycle and expiry.
-- Adds bounded recertification metadata. No secrets are stored.

ALTER TABLE `platform_plugin_smoke_certifications`
  ADD COLUMN IF NOT EXISTS `certification_expires_at` datetime DEFAULT NULL AFTER `certified_at`,
  ADD COLUMN IF NOT EXISTS `last_recertification_required_at` datetime DEFAULT NULL AFTER `certification_expires_at`,
  ADD COLUMN IF NOT EXISTS `recertification_reason` varchar(255) DEFAULT NULL AFTER `last_recertification_required_at`;

CREATE INDEX IF NOT EXISTS `idx_smoke_cert_expiry`
  ON `platform_plugin_smoke_certifications` (`certification_status`, `certification_expires_at`);

UPDATE `platform_plugin_smoke_certifications`
   SET `certification_expires_at` = DATE_ADD(COALESCE(`certified_at`, CURRENT_TIMESTAMP), INTERVAL 90 DAY)
 WHERE `certification_expires_at` IS NULL
   AND `certification_status` = 'certified';
