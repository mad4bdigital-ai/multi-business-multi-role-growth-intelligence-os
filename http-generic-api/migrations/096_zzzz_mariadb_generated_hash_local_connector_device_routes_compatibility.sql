-- MariaDB 11.4 compatibility bridge for immutable migration 097.
-- SHA2() is not permitted in a PERSISTENT generated column (ERROR 1901).
-- Materialize the same endpoint digest and maintain it with DDL-defined
-- BEFORE INSERT/UPDATE triggers. No DML or provider/runtime action.

CREATE TABLE IF NOT EXISTS local_connector_device_routes (
  route_id VARCHAR(36) NOT NULL PRIMARY KEY,
  config_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NULL,
  tenant_id VARCHAR(36) NULL,
  device_id VARCHAR(128) NULL,
  route_type ENUM(
    'cloudflare_tunnel',
    'direct_public_ip',
    'dynamic_public_ip',
    'vpn_private_ip',
    'lan_private_ip',
    'admin_recovery'
  ) NOT NULL,
  route_label VARCHAR(128) NULL,
  endpoint_url TEXT NOT NULL,
  endpoint_url_sha256 CHAR(64) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  is_customer_selectable TINYINT(1) NOT NULL DEFAULT 1,
  requires_admin_setup TINYINT(1) NOT NULL DEFAULT 0,
  requires_router_config TINYINT(1) NOT NULL DEFAULT 0,
  requires_vpn_agent TINYINT(1) NOT NULL DEFAULT 0,
  tls_mode ENUM('required','self_signed_allowed','plain_http_internal_only') NOT NULL DEFAULT 'required',
  auth_mode ENUM('bearer_connector_secret','mtls','none') NOT NULL DEFAULT 'bearer_connector_secret',
  health_status ENUM('unknown','healthy','degraded','down') NOT NULL DEFAULT 'unknown',
  last_health_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  last_error_code VARCHAR(128) NULL,
  last_error_message TEXT NULL,
  route_metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lcdr_config_type_endpoint (config_id, route_type, endpoint_url_sha256),
  KEY idx_lcdr_config_priority (config_id, is_enabled, priority),
  KEY idx_lcdr_user_device (user_id, device_id),
  KEY idx_lcdr_health (health_status, last_health_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE TRIGGER trg_local_connector_device_routes_endpoint_url_sha256_bi
BEFORE INSERT ON local_connector_device_routes
FOR EACH ROW
SET NEW.endpoint_url_sha256 = SHA2(NEW.endpoint_url, 256);

CREATE OR REPLACE TRIGGER trg_local_connector_device_routes_endpoint_url_sha256_bu
BEFORE UPDATE ON local_connector_device_routes
FOR EACH ROW
SET NEW.endpoint_url_sha256 = SHA2(NEW.endpoint_url, 256);
