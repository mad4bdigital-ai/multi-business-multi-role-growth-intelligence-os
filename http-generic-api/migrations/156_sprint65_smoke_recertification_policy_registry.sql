-- Sprint 65: Platform Plugin smoke recertification policy registry.
-- Moves recertification TTL, expiry window, batch caps, and auto enablement
-- from hardcoded defaults/tool-only inputs into governed SQL policy.

CREATE TABLE IF NOT EXISTS `platform_plugin_smoke_recertification_policies` (
  `policy_id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) DEFAULT NULL,
  `plugin_key` varchar(128) NOT NULL DEFAULT '*',
  `action_key` varchar(128) DEFAULT NULL,
  `mock_provider` varchar(128) DEFAULT NULL,
  `mock_resource` varchar(128) DEFAULT NULL,
  `certification_ttl_days` int NOT NULL DEFAULT 90,
  `expires_soon_days` int NOT NULL DEFAULT 14,
  `max_batch_size` int NOT NULL DEFAULT 5,
  `auto_recertification_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `provider_smoke_required` tinyint(1) NOT NULL DEFAULT 1,
  `allowed_expected_origin` varchar(300) DEFAULT NULL,
  `status` varchar(64) NOT NULL DEFAULT 'active',
  `priority` int NOT NULL DEFAULT 100,
  `notes` text DEFAULT NULL,
  `metadata_json` longtext DEFAULT NULL CHECK (json_valid(`metadata_json`)),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_id`),
  UNIQUE KEY `uniq_smoke_recert_policy_scope` (`tenant_id`,`plugin_key`,`action_key`,`mock_provider`,`mock_resource`),
  KEY `idx_smoke_recert_policy_match` (`status`,`tenant_id`,`plugin_key`,`action_key`,`mock_provider`,`mock_resource`,`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_plugin_smoke_recertification_policies` (
  `policy_id`, `tenant_id`, `plugin_key`, `action_key`, `mock_provider`, `mock_resource`,
  `certification_ttl_days`, `expires_soon_days`, `max_batch_size`,
  `auto_recertification_enabled`, `provider_smoke_required`, `allowed_expected_origin`,
  `status`, `priority`, `notes`, `metadata_json`
) VALUES (
  'smoke_recert_policy_default', NULL, '*', NULL, NULL, NULL,
  90, 14, 5,
  0, 1, NULL,
  'active', 1000,
  'Default conservative smoke recertification policy. Auto recertification disabled unless a narrower policy enables it.',
  JSON_OBJECT('source','migration_156','secrets_included',false)
)
ON DUPLICATE KEY UPDATE
  `certification_ttl_days` = VALUES(`certification_ttl_days`),
  `expires_soon_days` = VALUES(`expires_soon_days`),
  `max_batch_size` = VALUES(`max_batch_size`),
  `auto_recertification_enabled` = VALUES(`auto_recertification_enabled`),
  `provider_smoke_required` = VALUES(`provider_smoke_required`),
  `allowed_expected_origin` = VALUES(`allowed_expected_origin`),
  `status` = VALUES(`status`),
  `priority` = VALUES(`priority`),
  `notes` = VALUES(`notes`),
  `metadata_json` = VALUES(`metadata_json`);
