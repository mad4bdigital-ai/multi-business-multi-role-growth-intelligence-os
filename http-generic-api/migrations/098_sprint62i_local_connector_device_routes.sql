-- Sprint 62i: selectable local connector device routes
-- Supports automatic customer-choice routing modes without requiring technical setup knowledge.
-- Route selector should prefer healthy low-priority routes and fall back automatically.

CREATE TABLE IF NOT EXISTS `local_connector_device_routes` (
  `route_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `config_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NULL,
  `route_type` ENUM(
    'cloudflare_tunnel',
    'direct_public_ip',
    'dynamic_public_ip',
    'vpn_private_ip',
    'lan_private_ip',
    'admin_recovery'
  ) NOT NULL,
  `route_label` VARCHAR(128) NULL,
  `endpoint_url` VARCHAR(512) NOT NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_customer_selectable` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_admin_setup` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_router_config` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_vpn_agent` TINYINT(1) NOT NULL DEFAULT 0,
  `tls_mode` ENUM('required','self_signed_allowed','plain_http_internal_only') NOT NULL DEFAULT 'required',
  `auth_mode` ENUM('bearer_connector_secret','mtls','none') NOT NULL DEFAULT 'bearer_connector_secret',
  `health_status` ENUM('unknown','healthy','degraded','down') NOT NULL DEFAULT 'unknown',
  `last_health_at` DATETIME NULL,
  `last_success_at` DATETIME NULL,
  `last_failure_at` DATETIME NULL,
  `last_error_code` VARCHAR(128) NULL,
  `last_error_message` TEXT NULL,
  `route_metadata` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_lcdr_config_type_endpoint` (`config_id`, `route_type`, `endpoint_url`),
  KEY `idx_lcdr_config_priority` (`config_id`, `is_enabled`, `priority`),
  KEY `idx_lcdr_user_device` (`user_id`, `device_id`),
  KEY `idx_lcdr_health` (`health_status`, `last_health_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `local_connector_device_routes`
  (`route_id`, `config_id`, `user_id`, `tenant_id`, `device_id`, `route_type`, `route_label`, `endpoint_url`,
   `priority`, `is_enabled`, `is_customer_selectable`, `requires_admin_setup`, `requires_router_config`,
   `requires_vpn_agent`, `tls_mode`, `auth_mode`, `health_status`, `route_metadata`)
SELECT UUID(), config_id, user_id, tenant_id, device_id,
       'cloudflare_tunnel', 'Cloudflare Tunnel', COALESCE(device_runtime_url, tunnel_url),
       50, 1, 1, 0, 0, 0, 'required', 'bearer_connector_secret', 'unknown',
       JSON_OBJECT('source','migration_098','default_route',true)
  FROM `local_connector_user_configs`
 WHERE is_enabled = 1
   AND COALESCE(device_runtime_url, tunnel_url) IS NOT NULL
ON DUPLICATE KEY UPDATE
  endpoint_url = VALUES(endpoint_url),
  priority = VALUES(priority),
  is_enabled = VALUES(is_enabled),
  updated_at = NOW();

INSERT INTO `local_connector_device_routes`
  (`route_id`, `config_id`, `user_id`, `tenant_id`, `device_id`, `route_type`, `route_label`, `endpoint_url`,
   `priority`, `is_enabled`, `is_customer_selectable`, `requires_admin_setup`, `requires_router_config`,
   `requires_vpn_agent`, `tls_mode`, `auth_mode`, `health_status`, `route_metadata`)
SELECT UUID(), config_id, user_id, tenant_id, device_id,
       'admin_recovery', 'Admin recovery connector', COALESCE(admin_recovery_url, 'https://connector.mad4b.com'),
       90, 1, 0, 1, 0, 0, 'required', 'bearer_connector_secret', 'unknown',
       JSON_OBJECT('source','migration_098','admin_only',true)
  FROM `local_connector_user_configs`
 WHERE is_enabled = 1
   AND COALESCE(admin_recovery_url, 'https://connector.mad4b.com') IS NOT NULL
ON DUPLICATE KEY UPDATE
  endpoint_url = VALUES(endpoint_url),
  priority = VALUES(priority),
  is_enabled = VALUES(is_enabled),
  updated_at = NOW();
