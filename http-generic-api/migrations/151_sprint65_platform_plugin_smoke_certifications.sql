-- Sprint 65: Platform Plugin smoke certification registry.
-- Records read-only provider smoke evidence before plugin/action promotion or dispatch readiness.
-- Stores execution log references and safe metadata only; no credentials or secrets.

CREATE TABLE IF NOT EXISTS `platform_plugin_smoke_certifications` (
  `certification_id` varchar(64) NOT NULL,
  `plugin_key` varchar(128) NOT NULL,
  `action_key` varchar(128) NOT NULL,
  `endpoint_key` varchar(128) DEFAULT NULL,
  `tenant_id` varchar(64) DEFAULT NULL,
  `user_id` varchar(64) DEFAULT NULL,
  `connection_id` varchar(64) DEFAULT NULL,
  `mock_provider` varchar(128) NOT NULL,
  `mock_resource` varchar(128) NOT NULL,
  `expected_origin` varchar(300) NOT NULL,
  `url_origin` varchar(300) NOT NULL,
  `url_path` varchar(500) NOT NULL,
  `http_method` varchar(16) NOT NULL DEFAULT 'GET',
  `last_smoke_status` varchar(64) NOT NULL,
  `last_response_status` int DEFAULT NULL,
  `last_response_ok` tinyint(1) NOT NULL DEFAULT 0,
  `last_smoke_execution_log_id` bigint(20) unsigned NOT NULL,
  `last_smoke_trace_id` varchar(255) DEFAULT NULL,
  `certification_status` varchar(64) NOT NULL DEFAULT 'certified',
  `certified_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `certified_by` varchar(128) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `metadata_json` longtext DEFAULT NULL CHECK (json_valid(`metadata_json`)),
  `secrets_included` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`certification_id`),
  UNIQUE KEY `uniq_plugin_action_mock` (`plugin_key`,`action_key`,`mock_provider`,`mock_resource`),
  KEY `idx_smoke_cert_plugin_action` (`plugin_key`,`action_key`,`certification_status`),
  KEY `idx_smoke_cert_execution_log` (`last_smoke_execution_log_id`),
  KEY `idx_smoke_cert_connection` (`connection_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
